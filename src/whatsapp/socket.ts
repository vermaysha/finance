import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { NodeCache } from '@cacheable/node-cache';
import type { Boom } from '@hapi/boom';
import makeWASocket, {
  type AnyMessageContent,
  Browsers,
  type CacheStore,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type GroupParticipant,
  isJidBot,
  isJidMetaAI,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
  type MiscMessageGenerationOptions,
  makeCacheableSignalKeyStore,
  type WAConnectionState,
  type WASocket,
  type WAMessage,
  isLidUser,
  BufferJSON,
  proto,
} from 'baileys';
import { sleep } from 'bun';
import PQueue from 'p-queue';
import P from 'pino';
import { useStorage } from './storage';
import { renderANSI, renderUnicodeCompact } from 'uqr';
import { groupUpsert, messageUpsert } from '../events';
import { sql } from '../db';

const msgRetryCounterCache = new NodeCache({
  stdTTL: 60 * 60, // 1 hour
}) as CacheStore;
const userDevicesCache = new NodeCache({
  stdTTL: 60 * 60, // 1 hour
}) as CacheStore;
const placeholderResendCache = new NodeCache({
  stdTTL: 60 * 60, // 1 hour
}) as CacheStore;
const sessionCache = new NodeCache({
  stdTTL: 5 * 60, // 5 minutes
  useClones: false,
}) as CacheStore;
const retriesCount = 0;

export const startSocket = async () => {
  const logger = P({
    level: process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    formatters: {
      log(object) {
        const date = new Intl.DateTimeFormat('sv-SE', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZone: 'Asia/Jakarta',
        }).format(new Date());
        return { ...object, date };
      },
    },
  });

  sessionCache.flushAll();

  const { state, saveCreds, clearCreds } = await useStorage();

  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(
    `[Whatsapp] using WA v${version.join('.')}, isLatest: ${isLatest}`,
  );

  const sock = makeWASocket({
    version,
    logger: logger,
    browser: Browsers.macOS('Safari'),
    auth: {
      creds: state.creds,
      /** caching makes the store faster to send/recv messages */
      keys: makeCacheableSignalKeyStore(state.keys, logger, sessionCache),
    },
    generateHighQualityLinkPreview: true,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    msgRetryCounterCache: msgRetryCounterCache,
    userDevicesCache: userDevicesCache,
    placeholderResendCache: placeholderResendCache,
    shouldIgnoreJid: (jid) => {
      return !(isPnUser(jid) || isLidUser(jid));
    },
    cachedGroupMetadata: async (id) => {
      const results =
        await sql`SELECT data FROM groups WHERE id = ${id} LIMIT 1;`;
      const row = results[0]?.data;

      if (!row) return null;

      const group = JSON.parse(row, BufferJSON.reviver);

      if (!group) return null;

      return group;
    },
    getMessage: async (key) => {
      const id = key.id;
      const remoteJid = key.remoteJid;

      if (!id || !remoteJid) return undefined;

      const results =
        await sql`SELECT data FROM messages WHERE id = ${remoteJid}-${id} LIMIT 1;`;
      const row = results[0]?.data;

      if (!row) return undefined;

      const message = JSON.parse(row, BufferJSON.reviver);
      const data = proto.Message.create(message);

      if (!data) return undefined;

      return data;
    },
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    console.log(
      `[Whatsapp] Received ${messages.length} messages of type ${type}`,
    );

    for (const message of messages) {
      messageUpsert(sock, message);
    }
  });

  sock.ev.on('groups.upsert', (groups) => {
    console.log(`[Whatsapp] Received ${groups.length} group updates`);

    for (const group of groups) {
      groupUpsert(sock, group);
    }
  });

  sock.ev.on('messaging-history.set', (history) => {
    console.log(
      `[Whatsapp] Received messaging history with ${history.messages.length} messages`,
    );

    for (const message of history.messages) {
      messageUpsert(sock, message);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection) {
      console.log(`[Whatsapp] Connection status: ${connection}`);
    }

    if (qr) {
      console.log('[Whatsapp] QR Code received, scan please!');
      console.log(renderUnicodeCompact(qr, {}));
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const statusMsg = (
        (lastDisconnect?.error as Boom)?.message ?? ''
      ).toLowerCase();

      if (statusMsg.includes('qr refs attempts ended')) {
        console.log('[Whatsapp] QR attempts ended');
        cleanup();
        clearCreds();
        return Bun.sleep(1000).then(() => process.exit(1));
      }

      if (statusMsg.includes('proxy connection timed out')) {
        console.log('[Whatsapp] Proxy connection timed out');
        cleanup();
        clearCreds();
        return Bun.sleep(1000).then(() => process.exit(1));
      }

      if (
        statusMsg.includes('websocket error') &&
        statusMsg.includes('failed to connect')
      ) {
        console.log('[Whatsapp] Failed to connect to whatsapp websocket,');

        return Bun.sleep(3000).then(() => {
          cleanup();
          return startSocket();
        });
      }

      const restartedCodes = [
        DisconnectReason.restartRequired,
        DisconnectReason.connectionLost,
        DisconnectReason.connectionClosed,
        DisconnectReason.unavailableService,
        DisconnectReason.connectionReplaced,
        DisconnectReason.timedOut,
        DisconnectReason.badSession,
      ];

      const loggedOutCodes = [
        // DisconnectReason.badSession,
        DisconnectReason.loggedOut,
        DisconnectReason.multideviceMismatch,
        DisconnectReason.forbidden,
        // 406, // Banned
        // 402, // Temp banned
        // 405, // Client too old
      ];

      if (restartedCodes.includes(statusCode)) {
        console.log(
          `[Whatsapp] Connection closed, restarting (${statusCode} - ${statusMsg})`,
        );
        cleanup();
        return startSocket();
      }

      if (loggedOutCodes.includes(statusCode)) {
        console.log(
          `[Whatsapp] Connection closed, logged out (${statusCode} - ${statusMsg})`,
        );
        clearCreds();
        cleanup();
        return Bun.sleep(1000).then(() => process.exit(1));
      }

      console.log(
        `[Whatsapp] Connection closed due to ${lastDisconnect?.error}`,
      );

      cleanup();
      clearCreds();
      return Bun.sleep(1000).then(() => startSocket());
    }
  });
};

export const cleanup = () => {
  msgRetryCounterCache.flushAll();
  userDevicesCache.flushAll();
  placeholderResendCache.flushAll();
};
