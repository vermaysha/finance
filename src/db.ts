import { DATABASE_URL } from './config';

const path = DATABASE_URL;
export const sql = new Bun.SQL(path);

if (sql.options.adapter !== 'sqlite') {
  throw new Error('Database adapter harus SQLite.');
}

export const startMigration = async () => {
  await sql`PRAGMA journal_mode = WAL;`;
  await sql`PRAGMA foreign_keys = OFF;`;
  await sql`PRAGMA synchronous = NORMAL;`;
  await sql`PRAGMA temp_store = MEMORY;`;
  await sql.unsafe(`PRAGMA mmap_size = ${1024 * 1024 * 1024 * 2};`); // 2 GB
  await sql.unsafe(`PRAGMA cache_size = ${1024 * 1024 * 20 * -1};`); // 20 MB

  await sql`CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT PRIMARY KEY,
    "data" TEXT NOT NULL,
    "created_at" INTEGER DEFAULT (unixepoch()) NOT NULL,
    "updated_at" INTEGER DEFAULT (unixepoch()) NOT NULL
  ) STRICT;`;

  await sql`CREATE TABLE IF NOT EXISTS "groups" (
    "id" TEXT PRIMARY KEY,
    "data" TEXT NOT NULL,
    "created_at" INTEGER DEFAULT (unixepoch()) NOT NULL,
    "updated_at" INTEGER DEFAULT (unixepoch()) NOT NULL
  ) STRICT;`;

  await sql`CREATE TABLE IF NOT EXISTS "messages" (
    "id" TEXT PRIMARY KEY,
    "data" TEXT NOT NULL,
    "created_at" INTEGER DEFAULT (unixepoch()) NOT NULL,
    "updated_at" INTEGER DEFAULT (unixepoch()) NOT NULL
  ) STRICT;`;

  await sql`CREATE TABLE IF NOT EXISTS "transactions" (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    category TEXT,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    description TEXT,
    merchant_or_sender TEXT,
    "created_at" INTEGER DEFAULT (unixepoch()) NOT NULL,
    "updated_at" INTEGER DEFAULT (unixepoch()) NOT NULL
  ) STRICT;`;
};

export interface ITransaction {
  id: number;
  type: 'PENGELUARAN' | 'PEMASUKAN';
  category: string | null;
  amount: number;
  date: string;
  description: string | null;
  merchant_or_sender: string | null;
  created_at: number;
  updated_at: number;
}

export const getTotalBalance = async () => {
  const incomeResult =
    await sql`SELECT SUM(amount) as total_income FROM transactions WHERE type = 'PEMASUKAN';`;
  const expenseResult =
    await sql`SELECT SUM(amount) as total_expense FROM transactions WHERE type = 'PENGELUARAN';`;

  const totalIncome = incomeResult[0].total_income || 0;
  const totalExpense = expenseResult[0].total_expense || 0;

  return totalIncome - totalExpense;
};

export const getDailySummary = async () => {
  const result = await sql<
    {
      date: string;
      total_income: number;
      total_expense: number;
      net_total: number;
    }[]
  >`WITH RECURSIVE last_days(day_date) AS (
        SELECT date('now', 'localtime', '-45 days')
        UNION ALL
        SELECT date(day_date, '+1 day')
        FROM last_days
        WHERE day_date < date('now', 'localtime')
    )
    SELECT
        d.day_date AS date,
        COALESCE(SUM(CASE WHEN t.type = 'PEMASUKAN' THEN t.amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN t.type = 'PENGELUARAN' THEN t.amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN t.type = 'PEMASUKAN' THEN t.amount ELSE -t.amount END), 0) AS net_total
    FROM last_days d
    LEFT JOIN transactions t
        ON t.date = d.day_date
    GROUP BY d.day_date
    ORDER BY d.day_date DESC;`;

  return result;
};

export const getTransactions = async (type: string, limit: number) => {
  const transactions = await sql<
    ITransaction[]
  >`SELECT * FROM transactions WHERE type = ${type} ORDER BY date DESC LIMIT ${limit};`;
  return transactions;
};
