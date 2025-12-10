import {
  downloadMediaMessage,
  normalizeMessageContent,
  type WAMessage,
  type WASocket,
} from 'baileys';
import { generateResponse, type IBotMessage } from '../ai/ai';

export const messageUpsert = async (sock: WASocket, message: WAMessage) => {
  const keyId = message.key.id;
  const remoteJid = message.key.remoteJid;

  if (!keyId || !remoteJid) return;

  if (message.key.fromMe) return;

  await sock.sendPresenceUpdate('available', remoteJid);

  Bun.sleep(1000);

  const msg = normalizeMessageContent(message.message);
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
