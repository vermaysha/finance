const path = Bun.env.DATABASE_URL || 'file:./data/baileys.db';
export const sql = new Bun.SQL(path);

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

  await sql`CREATE TABLE IF NOT EXISTS "transactions" (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    category TEXT,
    amount INTEGER NOT NULL,
    date TEXT NOT NULL,
    description TEXT,
    merchant_or_sender TEXT,
    "created_at" INTEGER DEFAULT (unixepoch()) NOT NULL,
    "updated_at" INTEGER DEFAULT (unixepoch()) NOT NULL
  ) STRICT;`;
};
