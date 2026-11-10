// Replays a recorded day through the intraday seller engine and prints its simple answer at several times.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/research/seller-v14-replay.ts 2026-11-05 10:45 11:30 12:30 13:30 14:30
import { prisma } from '@mtv/db';
import { intraday } from '@mtv/options';
import { buildSnapshot, loadEvidence } from '../../src/seller/snapshot';

const [date = '2026-11-05', ...times] = process.argv.slice(2);
const list = times.length ? times : ['10:45', '11:30', '12:30', '13:30', '14:30'];
const ev = await loadEvidence();
const fmt = (v: number | null | undefined, d = 0) => (v == null ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const dot = { strong: '●G', mixed: '●A', weak: '●R', unknown: '○?' } as const;
let prev: intraday.View | null = null;
for (const t of list) {
  const now = Math.floor(Date.parse(`${date}T${t}:00+05:30`) / 1000);
  const v = intraday.analyze(await buildSnapshot(now, { live: true, source: `replay of ${date}` }), ev);
  console.log(`\n──────── ${v.header.line}   [${v.source}]`);
  if (prev) { const ch = intraday.whatChanged(prev, v); console.log(`Previous view: ${prev.sellerView}, ${prev.setup ? `${prev.setup.side} ${prev.setup.strike}` : 'no setup'} · What changed: ${ch.length ? ch.join('; ') : 'nothing material'}`); }
  if (v.stop) { console.log(v.stop); prev = v; continue; }
  console.log(`Direction: ${v.direction}${v.strength ? ` (${v.strength})` : ''}   Seller view: ${v.sellerView}   Mode: ${v.mode}`);
  if (v.setup) {
    const s = v.setup;
    console.log(`Preferred: ${fmt(s.strike)} ${s.side === 'CALL SELL' ? 'CE' : 'PE'} SELL (${s.expiry}) · premium ₹${fmt(s.premium, 2)} · lot ${s.lotSize ?? '—'} = ₹${fmt(s.lotValue)} · breakeven ${fmt(s.breakeven, 2)}`);
    console.log(`  ${fmt(s.distSpot)} pts from spot, ${fmt(s.distExtreme)} past the day's extreme · OI ${fmt(s.oi)} · volume ${fmt(s.volume)} · spread ${s.spreadPct == null ? '—' : (s.spreadPct * 100).toFixed(2) + '%'} · gamma ${s.gamma}${s.flags.length ? ' · ' + s.flags.join(', ') : ''}`);
    console.log(`  Invalidation: ${s.invalidation.text}${s.premiumAtInvalidation != null ? ` (premium then ≈ ₹${fmt(s.premiumAtInvalidation, 2)}, ESTIMATE — equal-moneyness interpolation from live chain)` : ''}`);
  }
  console.log('Why: ' + v.why.join(' '));
  if (v.notice) console.log(v.notice);
  console.log('Factor'.padEnd(20) + 'CALL'.padEnd(46) + 'PUT');
  for (const r of v.comparison) console.log(r.factor.padEnd(20) + `${dot[r.call.grade]} ${r.call.note}`.slice(0, 45).padEnd(46) + `${dot[r.put.grade]} ${r.put.note}`.slice(0, 50));
  console.log(`Sides: CALL ${v.sides.call?.verdict} (${v.sides.call?.chosen?.strike ?? 'none'}), PUT ${v.sides.put?.verdict} (${v.sides.put?.chosen?.strike ?? 'none'}) · walls: call ${v.audit.walls.call ? `${v.audit.walls.call.strike} ${v.audit.walls.call.strength.toFixed(1)}× ${v.audit.walls.call.status}` : '—'}, put ${v.audit.walls.put ? `${v.audit.walls.put.strike} ${v.audit.walls.put.strength.toFixed(1)}× ${v.audit.walls.put.status}` : '—'} · PCR ${v.audit.pcr?.toFixed(2) ?? '—'}`);
  console.log(`E4: ${v.audit.e4.note}`);
  console.log(`Two-sided: ${v.twoSided.offered ? 'offered' : 'NOT OFFERED — ' + v.twoSided.failed.join('; ')}`);
  console.log(v.log);
  prev = v;
}
await prisma.$disconnect();
