import { google } from 'googleapis';
import type { IAIResponse } from '../ai';

export const SPREADSHEET_ID = Bun.env.SPREADSHEET_ID;
export const GCLOUD_KEY_PATH = Bun.env.GCLOUD_KEY_PATH;
export const SHEET_NAME = Bun.env.SHEET_NAME || 'Logs';

const auth = new google.auth.GoogleAuth({
  keyFile: GCLOUD_KEY_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

export const saveToSheetDirect = async (data: IAIResponse) => {
  if (!SPREADSHEET_ID || !GCLOUD_KEY_PATH) return;
  if (!data.is_transaction || !data.transaction_data) return;

  const t = data.transaction_data;

  const rowData = [
    t.date || new Date().toISOString().split('T')[0], // Kolom A: Date
    t.type, // Kolom B: Type
    t.category, // Kolom C: Category
    t.amount, // Kolom D: Amount
    t.merchant_or_sender, // Kolom E: Merchant
    t.description, // Kolom F: Desc
  ];

  try {
    const googleSheets = google.sheets({ version: 'v4', auth: auth });

    await googleSheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:F`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowData],
      },
    });

    return true;
  } catch (error) {
    return false;
  }
};
