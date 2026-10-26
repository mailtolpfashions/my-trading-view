// Local Postgres for development, no Docker or installer needed (same approach as the Kicko CRM).
// Production uses a managed Postgres; only DATABASE_URL changes.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = path.join(root, '.pgdata');
const firstRun = !existsSync(dataDir);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 5434, // the CRM uses 5433
  persistent: true,
  // Windows defaults to WIN1252; we need UTF-8 for ₹.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

if (firstRun) await pg.initialise();
await pg.start();

const client = pg.getPgClient();
await client.connect();
const { rowCount } = await client.query(`SELECT 1 FROM pg_database WHERE datname = 'mytradingview'`);
if (!rowCount) await client.query(`CREATE DATABASE mytradingview ENCODING 'UTF8' TEMPLATE template0`);
await client.query(`ALTER DATABASE mytradingview SET timezone TO 'UTC'`);
await client.end();

console.log('Postgres ready on postgresql://localhost:5434/mytradingview (Ctrl+C to stop)');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
