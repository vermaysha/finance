import './config';
import { sql, startMigration } from './db';
import { startSocket } from './whatsapp';

const start = async () => {
  console.log('[APP] Starting application');
  await sql.connect();
  await startMigration();
  console.log('[DB] Database connected and migrations applied.');

  startSocket();
};

const shutdown = async (code: NodeJS.Signals) => {
  console.log(`[APP] Caught ${code}, exiting gracefully`);
  await sql.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
