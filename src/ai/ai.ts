import { GoogleGenAI, type ContentListUnion } from '@google/genai';
import {
  SYSTEM_PROMPT,
  type IAIResponse,
  type ITransactionData,
} from './promt';
import { sql } from '../db';
import { saveToSheetDirect } from '../spreadsheet';

export interface IBotMessage {
  message?: string;
  image?: {
    data: string;
    mimeType: string;
  } | null;
}

const GEMINI_API_KEY = Bun.env.GEMINI_API_KEY;
const systemInstructions = SYSTEM_PROMPT;

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in environment variables');
}

export const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export const generateResponse = async (msg: IBotMessage | string) => {
  const contents: ContentListUnion = [];

  if (typeof msg === 'string') {
    contents.push({ text: msg });
  } else if (msg.image) {
    contents.push({
      inlineData: msg.image,
    });
    contents.push({
      text: msg.message ?? 'Analisis gambar ini',
    });
  } else if (msg.message) {
    contents.push({
      text: msg.message,
    });
  }

  if (contents.length === 0) {
    throw new Error('No valid content to generate response');
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: contents,
    config: {
      systemInstruction: systemInstructions,
      responseMimeType: 'application/json',
    },
  });

  const result = response.text;

  if (!result) {
    return null;
  }

  const data = JSON.parse(result) as IAIResponse;

  const dateFormat = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  });

  if (data.is_transaction) {
    const transaction: ITransactionData = {
      amount: data.transaction_data?.amount || 0,
      category: data.transaction_data?.category ?? null,
      date: data.transaction_data?.date
        ? dateFormat.format(new Date(data.transaction_data.date))
        : dateFormat.format(new Date()),
      description: data.transaction_data?.description ?? null,
      type: data.transaction_data?.type ?? null,
      merchant_or_sender: data.transaction_data?.merchant_or_sender ?? null,
    };

    await sql`INSERT INTO transactions ${sql(transaction)}`;
    await saveToSheetDirect(data);
  }

  return data;
};
