import {
  BufferJSON,
  downloadMediaMessage,
  normalizeMessageContent,
  type WAMessage,
  type WASocket,
} from 'baileys';
import { generateResponse, type IBotMessage } from '../ai/ai';
import { sql } from '../db';
import { ALLOWED_USER_IDS } from '../config';

const allowedIds = ALLOWED_USER_IDS;
export const messageUpsert = async (sock: WASocket, message: WAMessage) => {
  const keyId = message.key.id;
  const remoteJid = message.key.remoteJid;
  const phoneNumber =
    message.key.remoteJidAlt?.replace(/[^0-9]/g, '') ??
    message.key.participantAlt?.replace(/[^0-9]/g, '') ??
    null;

  if (!keyId || !remoteJid) return;

  if (message.key.fromMe) return;

  await Promise.all([
    saveMessage(message, keyId, remoteJid),
    handleBotMessage(sock, message, remoteJid, phoneNumber),
  ]);
};

const saveMessage = async (
  message: WAMessage,
  keyId: string,
  remoteJid: string,
) => {
  const data = {
    id: `${remoteJid}-${keyId}`,
    data: JSON.stringify(message.message, BufferJSON.replacer),
  };

  return await sql`INSERT INTO
    messages ${sql(data)}
  ON CONFLICT (id)
  DO UPDATE SET
    data = EXCLUDED.data,
    updated_at = unixepoch();
  `;
};

const handleBotMessage = async (
  sock: WASocket,
  message: WAMessage,
  remoteJid: string,
  phoneNumber: string | null,
) => {
  const msg = normalizeMessageContent(message.message);

  if (
    phoneNumber &&
    allowedIds.length > 0 &&
    !allowedIds.includes(phoneNumber)
  ) {
    console.log(`User ID ${phoneNumber} tidak diizinkan.`);
    return;
  }

  await sock.sendPresenceUpdate('available', remoteJid);

  Bun.sleep(1000);

  let bot: IBotMessage | null = null;
  let response: string | null = null;

  if (!msg) {
    console.log('Konten pesan kosong');
    return;
  }

  if (msg.conversation) {
    bot = {
      message: msg.conversation,
    };
  }

  if (msg.extendedTextMessage?.text) {
    bot = {
      message: msg.extendedTextMessage.text,
    };
  }

  if (msg.imageMessage) {
    try {
      console.log('Pesan gambar diterima');

      const buffer = await downloadMediaMessage(
        message,
        'buffer',
        {},
        {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );

      const mimeType = msg.imageMessage.mimetype || 'image/jpeg';

      bot = {
        image: {
          data: buffer.toString('base64'),
          mimeType: mimeType,
        },
        message: msg.imageMessage.caption || undefined,
      };
    } catch (error) {
      console.error('Gagal mengunduh pesan gambar:', error);
      response = 'Maaf, terjadi kesalahan saat memproses gambar Anda.';
    }
  }

  await sock.readMessages([message.key]);

  Bun.sleep(1000);

  if (response) {
    await sock.sendMessage(remoteJid, { text: response }, { quoted: message });
    return;
  }

  if (bot) {
    try {
      const botResponse = await generateResponse(bot);
      if (!botResponse) {
        console.log('Tidak ada respons dari bot');
        await sock.sendMessage(
          remoteJid,
          { text: 'Maaf, saya tidak dapat memberikan respons saat ini.' },
          { quoted: message },
        );
        return;
      }

      await sock.sendMessage(
        remoteJid,
        { text: botResponse.reply_text },
        { quoted: message },
      );
    } catch (error) {
      console.error('Gagal menghasilkan respons bot:', error);
      await sock.sendMessage(
        remoteJid,
        { text: 'Maaf, terjadi kesalahan saat memproses permintaan Anda.' },
        { quoted: message },
      );
    }
    return;
  }
};
