// Builds the intraday seller engine's snapshot (packages/options/src/intraday) from what the feed has stored: the
// 1-minute bars (live bars are appended to the same store as each minute finishes) and the option recorder's minutes.
// The same function serves the live view (now) and a replay of a recorded day at any time.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { intraday } from '@mtv/options';
import { MinuteStore, dateOfIst } from '../intraday/store';
import { OptionStore, type OptionMinute } from '../intraday/options';

type Minute = intraday.Minute;
const HEAVY = ['HDFCBANK', 'ICICIBANK', 'RELIANCE', 'INFY', 'TCS'];
const UNKNOWN = ['global market cues (no source)', 'scheduled event calendar (no source)', 'order-book depth (not recorded)', 'intraday FII/DII flows (NSE publishes them after the close)'];
const minutes = new MinuteStore();
const options = new OptionStore();

/** Minutes of `symbol` on `date` and on the session before it (from the stored 1-minute bars). */
async function dayAndPrev(symbol: string, date: string) {
  const from = Math.floor(Date.parse(`${date}T00:00:00+05:30`) / 1000) - 12 * 86400;
  const bars = (await minutes.read(symbol, from)) as Minute[];
  const byDay = new Map<string, Minute[]>();
  for (const b of bars) { const d = dateOfIst(b.time); if (d <= date) (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(b); }
  const prevDay = [...byDay.keys()].filter((d) => d < date).sort().at(-1);
  const sort = (x?: Minute[]) => (x ?? []).sort((a, b) => a.time - b.time);
  return { today: sort(byDay.get(date)), prev: prevDay ? sort(byDay.get(prevDay)) : [], prevDay, byDay };
}

/** ATR(14), Wilder, from NSE daily bars before `date`, and that session's official close. */
async function dailyContext(date: string) {
  const rows = await prisma.indexEod.findMany({ where: { name: 'NIFTY 50', date: { lt: date } }, orderBy: { date: 'asc' }, select: { date: true, highPaise: true, lowPaise: true, closePaise: true } });
  const d = rows.map((r) => ({ date: r.date, h: r.highPaise / 100, l: r.lowPaise / 100, c: r.closePaise / 100 }));
  let atr: number | null = null; const trs: number[] = [];
  for (let i = 1; i < d.length; i++) { const tr = Math.max(d[i].h - d[i].l, Math.abs(d[i].h - d[i - 1].c), Math.abs(d[i].l - d[i - 1].c)); if (atr == null) { trs.push(tr); if (trs.length === 14) atr = trs.reduce((a, b) => a + b, 0) / 14; } else atr = (atr * 13 + tr) / 14; }
  const vix = await prisma.indexEod.findFirst({ where: { name: 'INDIA VIX', date: { lt: date } }, orderBy: { date: 'desc' }, select: { date: true, closePaise: true } });
  return { atr, atrNote: atr == null ? 'not enough daily history' : `Wilder ATR(14) on ${d.length} daily bars to ${d.at(-1)?.date} (seeded ${d[1]?.date}, not seed-heavy)`, officialPrevClose: d.at(-1)?.c ?? null, vix: vix ? vix.closePaise / 100 : null, vixDate: vix?.date ?? null };
}

/** The nearest unexpired weekly expiry's chain at `now`, from the option recorder's minutes. */
function chainAt(rows: OptionMinute[], now: number, date: string): { expiry: string; rows: intraday.ChainRow[] } | null {
  const done = rows.filter((r) => r.time + 60 <= now);
  const expiry = [...new Set(done.map((r) => r.expiry))].filter((e) => e >= date).sort()[0];
  if (!expiry) return null;
  const by = new Map<string, OptionMinute[]>();
  for (const r of done) if (r.expiry === expiry) { const k = `${r.strike}|${r.right}`; (by.get(k) ?? by.set(k, []).get(k)!).push(r); }
  const out: intraday.ChainRow[] = [];
  for (const list of by.values()) {
    list.sort((a, b) => a.time - b.time);
    const last = list.at(-1)!, ois = list.map((x) => x.oi).filter((x) => x > 0);
    out.push({
      strike: last.strike, right: last.right, ltp: last.close || null, bid: last.bid || null, ask: last.ask || null,
      oi: last.oi || null, oiOpen: ois[0] ?? null, oiDayHigh: ois.length ? Math.max(...ois) : null, oiDayLow: ois.length ? Math.min(...ois) : null,
      volume: list.reduce((a, x) => a + x.volume, 0),
    });
  }
  return { expiry, rows: out };
}

async function lotSizeOn(date: string, expiry: string): Promise<number | null> {
  const r = await prisma.fnoDerivedDay.findFirst({ where: { underlying: 'NIFTY', expiry, date: { lte: date }, lotSize: { not: null } }, orderBy: { date: 'desc' }, select: { lotSize: true } })
    ?? await prisma.fnoDerivedDay.findFirst({ where: { underlying: 'NIFTY', date: { lte: date }, lotSize: { not: null } }, orderBy: { date: 'desc' }, select: { lotSize: true } });
  return r?.lotSize ?? null;
}

/** Snapshot at `now` (epoch seconds) of the session on that date. `live` = the feed is streaming right now. */
export async function buildSnapshot(now: number, opts: { live: boolean; source?: string; liveVix?: number | null } ): Promise<intraday.Snapshot> {
  const date = dateOfIst(now);
  const [n, bn, ctx, opt, ...heavy] = await Promise.all([
    dayAndPrev('NIFTY', date), dayAndPrev('BANKNIFTY', date), dailyContext(date), options.read('NIFTY', date), ...HEAVY.map((s) => dayAndPrev(s, date)),
  ]);
  const prev15 = [...n.byDay.keys()].filter((d) => d < date).sort().flatMap((d) => intraday.candles15(n.byDay.get(d)!.sort((a, b) => a.time - b.time), 930).map((c) => c.close)).slice(-60);
  const chain = chainAt(opt, now, date);
  const unknown = [...UNKNOWN];
  if (!chain) unknown.push('option chain (recorder has no minutes for this time)');
  return {
    now, live: opts.live && n.today.length > 0, source: opts.source ?? (opts.live ? 'live' : `replay of ${date}`),
    nifty: n.today, refClose: n.prev.at(-1)?.close ?? null, officialPrevClose: ctx.officialPrevClose,
    atr: ctx.atr, atrNote: ctx.atrNote,
    vix: opts.liveVix ?? ctx.vix, vixNote: opts.liveVix != null ? 'live' : ctx.vixDate ? `previous close (${ctx.vixDate}); live VIX not recorded in history` : 'UNKNOWN',
    prev15Closes: prev15,
    bank: { minutes: bn.today, refClose: bn.prev.at(-1)?.close ?? null },
    heavy: HEAVY.map((s, i) => ({ symbol: s, minutes: heavy[i].today, refClose: heavy[i].prev.at(-1)?.close ?? null })),
    chain: chain ? { ...chain, lotSize: await lotSizeOn(date, chain.expiry) } : null,
    unknown,
  };
}

/** Days with recorded NIFTY option minutes: first and last minute, and how many minutes (for the replay picker). */
export async function sellerDays(): Promise<{ date: string; first: string; last: string; minutes: number }[]> {
  const dir = path.join(options.dir, 'NIFTY');
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => /^\d{4}-\d{2}-\d{2}\.bin$/.test(f)).sort().reverse();
  const hm = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(11, 16);
  const out = [];
  for (const f of files.slice(0, 30)) {
    const date = f.slice(0, 10);
    const times = [...new Set((await options.read('NIFTY', date)).map((r) => r.time))].sort((a, b) => a - b);
    if (times.length) out.push({ date, first: hm(times[0]), last: hm(times.at(-1)!), minutes: times.length });
  }
  return out;
}

let cached: { at: number; ev: intraday.Evidence } | null = null;
/** The measured evidence (scripts/research/seller-v14-evidence.ts), re-read at most once a minute. */
export async function loadEvidence(): Promise<intraday.Evidence> {
  if (cached && Date.now() - cached.at < 60_000) return cached.ev;
  const ev = JSON.parse(await readFile(path.resolve(import.meta.dirname, '../../.data/research/seller-v14-evidence.json'), 'utf8')) as intraday.Evidence;
  cached = { at: Date.now(), ev };
  return ev;
}
