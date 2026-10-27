// Prints the database size and the largest tables (read-only).
import { prisma } from '@mtv/db';
const total = await prisma.$queryRaw<{ size: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
const tables = await prisma.$queryRaw<{ name: string; size: string; rows: bigint }[]>`
  SELECT c.relname AS name, pg_size_pretty(pg_total_relation_size(c.oid)) AS size, c.reltuples::bigint AS rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 8`;
const days = await prisma.eodFetch.count({ where: { status: 'saved' } });
const fno = await prisma.fnoFetch.count({ where: { status: 'saved' } });
console.log('database', total[0].size, '| equity days saved', days, '| F&O days saved', fno);
for (const t of tables) console.log(`  ${t.name.padEnd(18)} ${t.size.padStart(9)}  ~${t.rows} rows`);
await prisma.$disconnect();
