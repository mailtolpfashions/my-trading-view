// Cross-check against Chartink (user screenshot, 10 Nov 2026, data of 9 Nov): Monthly RSI(14) crossed above 60 AND
// Monthly Close crossed above Monthly Upper Bollinger band(20,1). Chartink uses the month still forming.
import { prisma } from '@mtv/db';
import { loadEod } from '../../src/eod/store';
import { runScreen } from '../../src/screener/screener';
await loadEod(() => {});
const chartink = ['AGARWALEYE','NIFTYPSUBANK','PSUBANK','PSUBNKIETF','PSUBANKADD','PSUBNKBEES','MANKIND','UNOMINDA','FOSECOIND','ASAHIINDIA','NGLFINE','CAPLIPOINT','ENGINERSIN','ANGELONE','ICICIBANK','BANKBETA','RELCNX100','EIMCOELECO','SBIBANKNIF','BANKBETF'];
const formulas: [string, string][] = [
  ['correct (BB 20,1, now)', '[M] CROSSOVER(RSI(CLOSE, 14), 60) AND CROSSOVER([M] CLOSE, [M] BB_UPPER(CLOSE, 20, 1))'],
  ['app with now (BB 20,2)', '[M] CROSSOVER(RSI(CLOSE, 14), 60) AND CROSSOVER([M] CLOSE, [M] BB_UPPER(CLOSE, 20, 2))'],
];
for (const [name, formula] of formulas) for (const universe of [{ kind: 'all' }] as const) {
  try {
    const r = await runScreen({ formula, tf: 'M', universe: universe as never, candle: 'live', limit: 1000 });
    const mine = new Set(r.rows.map((x) => x.symbol));
    console.log(`\n${name} | ${JSON.stringify(universe)} | as of ${r.asOf} scanned ${r.scanned} matches ${r.matches}`);
    console.log('  Chartink top-20 found by us:', chartink.filter((s) => mine.has(s)).join(' ') || '-');
    console.log('  Chartink top-20 NOT found  :', chartink.filter((s) => !mine.has(s)).join(' ') || '-');
    console.log('  ours:', [...mine].slice(0, 80).join(' '));
  } catch (e) { console.log(name, JSON.stringify(universe), 'ERR', (e as Error).message); }
}
await prisma.$disconnect();
process.exit(0);
