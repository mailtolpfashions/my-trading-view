// Seeds the intraday seller calibration log from recorded days: replays the engine every 5 minutes 09:20–15:25 on each
// day with option minutes (source 'replay'), then settles it. Days that already have live runs are left alone.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/seller-calibration-backfill.ts [YYYY-MM-DD…]
import { prisma } from '@mtv/db';
import { intraday } from '@mtv/options';
import { buildSnapshot, loadEvidence, sellerDays } from '../../src/seller/snapshot';
import { calibrationSummary, logRun, readDay, settleDay } from '../../src/seller/calibration';

const ev = await loadEvidence();
const today = new Date(Date.now() + 19800_000).toISOString().slice(0, 10);
const want = process.argv.slice(2);
const days = (await sellerDays()).map((d) => d.date).filter((d) => d < today && (!want.length || want.includes(d))).sort();
for (const date of days) {
  const existing = await readDay(date);
  if (existing?.entries.some((e) => e.source === 'live')) { console.log(`${date}: has live runs, skipped`); continue; }
  let n = 0, setups = 0;
  for (let min = 9 * 60 + 20; min <= 15 * 60 + 25; min += 5) {
    const at = Math.floor(Date.parse(`${date}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00+05:30`) / 1000);
    const view = intraday.analyze(await buildSnapshot(at, { live: true, source: `replay of ${date}` }), ev);
    if (view.audit.spot == null) continue;
    await logRun(view, at, 'replay');
    n++; if (view.setup) setups++;
  }
  const d = await settleDay(date);
  const s = d?.settled;
  console.log(`${date}: ${n} runs, ${setups} with a setup → ${s ? `${s.setups.length} distinct setups, close ${s.close1530}, P&L ${s.setups.map((x) => x.pnlHold ?? 'NA').join(', ') || '–'}` : 'not settled (session incomplete)'}`);
}
const sum = await calibrationSummary();
console.log('\nTotals', JSON.stringify(sum.totals));
console.log('Breach odds predicted vs actual', JSON.stringify(sum.breach));
console.log('E4 predicted vs actual', JSON.stringify(sum.e4));
for (const s of sum.setups) console.log(`  ${s.date} ${s.firstAt} ${s.side} ${s.strike} bid ${s.entryBid} → ask ${s.exitAsk} @${s.exitAt}, worst ${s.worstAsk}, inv ${s.invalidatedAt ?? '-'}, reached ${s.touched1529}, P&L ${s.pnlHold} / ${s.pnlWithInvalidation}  ${s.notes.join('; ')}`);
await prisma.$disconnect();
