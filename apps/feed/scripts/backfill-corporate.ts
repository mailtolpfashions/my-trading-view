// Re-reads NSE's corporate-action file (Bc, in the daily PR bundle) for saved trading days and stores any actions
// missing from the database. Needed once after Oct 2025, when NSE changed the file's date format and our reader
// skipped every row. Downloads politely (shared NSE queue).
// Run: npx tsx --env-file=../../.env scripts/backfill-corporate.ts [from YYYY-MM-DD] [to YYYY-MM-DD]
import { unzipSync, strFromU8 } from 'fflate';
import { prisma } from '@mtv/db';
import { findBcFile, parseBc, prBundleUrl } from '../src/eod/corporate';
import { nseGet, NotPublished } from '../src/nse-http';

const from = process.argv[2] ?? '2025-10-01', to = process.argv[3] ?? '9999-12-31';
const days = (await prisma.eodFetch.findMany({ where: { status: 'saved', date: { gte: from, lte: to } }, orderBy: { date: 'asc' }, select: { date: true } })).map((d) => d.date);
console.log(`${days.length} trading days ${days[0]} → ${days.at(-1)}`);
const before = await prisma.corporateAction.count();
let read = 0, failed = 0;
for (const date of days) {
  try {
    const pr = unzipSync(new Uint8Array(await (await nseGet(prBundleUrl(date))).arrayBuffer()));
    const name = findBcFile(Object.keys(pr));
    if (!name) throw new Error('no Bc file in PR bundle');
    const actions = parseBc(strFromU8(pr[name]));
    await prisma.corporateAction.createMany({ data: actions.map((a) => ({ ...a, firstSeen: date })), skipDuplicates: true });
    read += actions.length;
  } catch (e) {
    failed++;
    console.log(`  ${date}: ${e instanceof NotPublished ? 'not published' : (e as Error).message}`);
  }
}
const after = await prisma.corporateAction.count();
const top = await prisma.$queryRawUnsafe<{ mx: string }[]>('select max("exDate") mx from "CorporateAction"');
console.log(`read ${read} rows, ${after - before} new actions stored, ${failed} days failed; latest ex-date now ${top[0].mx}`);
await prisma.$disconnect();
