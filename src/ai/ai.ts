import { GoogleGenAI, type ContentListUnion } from '@google/genai';
import {
  SYSTEM_PROMPT,
  type IAIResponse,
  type ITransactionData,
} from './promt';
import { getDailySummary, getTotalBalance, getTransactions, sql } from '../db';
import { saveToSheetDirect } from '../spreadsheet';
import { GEMINI_API_KEY, GEMINI_HOST, GEMINI_MODEL } from '../config';

export interface IBotMessage {
  message?: string;
  image?: {
    data: string;
    mimeType: string;
  } | null;
}

const systemInstructions = SYSTEM_PROMPT;

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in environment variables');
}

export const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
  httpOptions: {
    baseUrl: GEMINI_HOST,
  },
});

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

  const dailySummary = await getDailySummary();
  const totalBalance = await getTotalBalance();
  const latestIncome = await getTransactions('PEMASUKAN', 10);
  const latestExpense = await getTransactions('PENGELUARAN', 10);

  const additionalContexts = `\n\nData Keuanganku saat ini:
- Total Saldo: Rp${totalBalance.toLocaleString('id-ID')}
- Ringkasan Harian:
${dailySummary
  .map(
    (item) =>
      `  - Tanggal: ${item.date}, Pemasukan: Rp${item.total_income.toLocaleString(
        'id-ID',
      )}, Pengeluaran: Rp${item.total_expense.toLocaleString('id-ID')}`,
  )
  .join('\n')}
- 10 Transaksi Pemasukan Terbaru:
${latestIncome
  .map(
    (item) =>
      `  - Rp${item.amount.toLocaleString(
        'id-ID',
      )} ${item.merchant_or_sender ? `dari ${item.merchant_or_sender}` : ''} pada ${item.date} (${item.description})`,
  )
  .join('\n')}
- 10 Transaksi Pengeluaran Terbaru:
${latestExpense
  .map(
    (item) =>
      `  - Rp${item.amount.toLocaleString(
        'id-ID',
      )} ${item.merchant_or_sender ? `ke ${item.merchant_or_sender}` : ''} pada ${item.date} (${item.description})`,
  )
  .join('\n')}`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: contents,
    config: {
      systemInstruction: systemInstructions + additionalContexts,
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
