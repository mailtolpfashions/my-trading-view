// Trade lab "9:20 straddle" forward paper test (the rule from a YouTube episode the user asked to test, 2026-11-18).
// Every trading day at 09:20 IST: sell 1 lot (or the set lots) each of the NIFTY ATM call and put on the nearest
// expiry, today's included (0 DTE). Each leg gets its own stop-loss buy at 20% above its fill. Whatever is open at
// 15:20 is bought back. Days to expiry are recorded so results can be read per DTE, as in the video.
// The user chose the video's times over their own 09:30–15:00 window for this test only (ignoreWindow).
// Entries are NRML so the lab's 15:00 intraday square-off does not close them; this rule closes them itself.
// If the app was not running at 15:20, the legs are closed at the next chance and that day is marked "not clean".
// Rule, log and entries: .userdata/tradelab-straddle920.json (git-ignored).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { live } from '../intraday/instance';
import { istDate, istMinute, type TradeLab } from './engine';
import { kiteMarket, prismaRepo } from './live';
import { LabError } from './types';

export type S920Rule = { id: string; name: string; enabled: boolean; underlying: 'NIFTY'; entry: string; exit: string; stopPct: number; lots: number; updatedAt: string };
export type S920Leg = { symbol: string; label: string; kind: 'CE' | 'PE'; strikePaise: number; bidPaise: number; askPaise: number; orderId: string | null; fillPaise: number | null; stopPaise: number | null; stopOrderId: string | null };
export type S920Entry = { date: string; expiry: string; dte: number; at: number; spotPaise: number; legs: S920Leg[]; closedAt: number | null; clean: boolean; note: string | null };
export type S920Event = { at: number; action: 'placed' | 'skipped' | 'error' | 'checked' | 'closed'; text: string };
type Doc = { rule: S920Rule; events: S920Event[]; entries: S920Entry[] };

export const DEFAULT_S920_RULE: S920Rule = { id: 'straddle-920', name: '9:20 straddle (video rule)', enabled: false, underlying: 'NIFTY', entry: '09:20', exit: '15:20', stopPct: 20, lots: 1, updatedAt: '' };
export const S920_SOURCE = 'S920:straddle-920';
const FILE = path.resolve(import.meta.dirname, '../../../../.userdata/tradelab-straddle920.json');
const MAX_EVENTS = 3000;
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const tick5 = (p: number) => Math.ceil(p / 5) * 5; // NSE option tick ₹0.05, rounded up for a buy stop

/** Trading days from `today` to `expiry`, counting weekdays only (0 = expiry day). NSE holidays are not known ahead. */
export function weekdaysTo(today: string, expiry: string): number {
  let n = 0;
  for (let t = Date.parse(`${today}T00:00:00Z`) + 864e5; t <= Date.parse(`${expiry}T00:00:00Z`); t += 864e5) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
/** The strike nearest the index (ties go to the lower strike). */
export function atmStrike(strikes: number[], spotPaise: number): number | null {
  let best: number | null = null;
  for (const s of strikes) if (best == null || Math.abs(s - spotPaise) < Math.abs(best - spotPaise)) best = s;
  return best;
}
/** The stop for a sold leg: `pct` above its fill, on the ₹0.05 tick. */
export const stopFor = (fillPaise: number, pct: number) => tick5(fillPaise * (1 + pct / 100));

let doc: Doc | null = null;
let writing: Promise<void> = Promise.resolve();
async function load(): Promise<Doc> {
  if (doc) return doc;
  doc = await readFile(FILE, 'utf8').then((t) => { const j = JSON.parse(t) as Partial<Doc>; return { events: [], entries: [], ...j, rule: { ...DEFAULT_S920_RULE, ...j.rule } } as Doc; }, () => ({ rule: { ...DEFAULT_S920_RULE }, events: [], entries: [] }));
  return doc;
}
function save() {
  const snapshot = JSON.stringify(doc, null, 1);
  writing = writing.then(async () => { await mkdir(path.dirname(FILE), { recursive: true }); await writeFile(`${FILE}.tmp`, snapshot); await rename(`${FILE}.tmp`, FILE); }).catch(() => undefined);
  return writing;
}
function log(action: S920Event['action'], text: string, at = Math.floor(Date.now() / 1000)) {
  doc!.events.push({ at, action, text });
  if (doc!.events.length > MAX_EVENTS) doc!.events.splice(0, doc!.events.length - MAX_EVENTS);
}

export class S920Error extends Error {}
export async function s920Events(limit = 200) { return (await load()).events.slice(-limit).reverse(); }
export async function saveS920Rule(input: Partial<S920Rule>): Promise<S920Rule> {
  const d = await load();
  const r: S920Rule = { ...d.rule, enabled: input.enabled ?? d.rule.enabled, stopPct: Number(input.stopPct ?? d.rule.stopPct), lots: Math.round(Number(input.lots ?? d.rule.lots)), updatedAt: new Date().toISOString() };
  if (!(r.stopPct >= 5 && r.stopPct <= 100)) throw new S920Error('Stop must be 5% to 100%');
  if (!(r.lots >= 1 && r.lots <= 10)) throw new S920Error('Lots must be 1 to 10');
  d.rule = r;
  await save();
  return r;
}

// ---------------------------------------------------------------- the runner

let armedOn: string | null = null, armedAt = 0;
const ARM_WAIT_SEC = 20, LATE_MIN = 5;

/** Called every 15 seconds beside the other rules. */
export async function s920Tick(lab: TradeLab, now = Math.floor(Date.now() / 1000)) {
  const d = await load();
  const rule = d.rule;
  if (!kiteMarket.isOpen(now)) return;
  const today = istDate(now), min = istMinute(now);

  // 1. Close: today's legs at the exit time; an older day's legs (app was off at the exit) at the first chance.
  for (const e of d.entries.filter((x) => x.closedAt == null)) {
    if (e.date === today && min < hm(rule.exit)) continue;
    for (const l of e.legs) {
      if (!l.fillPaise) continue;
      try {
        const o = await lab.exit(l.symbol, 'NRML', S920_SOURCE, e.date === today ? `${rule.name}: ${rule.exit} exit` : `${rule.name}: closed late, the app was not running at ${rule.exit} on ${e.date}`);
        if (o) log('closed', `Bought back ${l.label}${o.avgFillPaise != null ? ` at ₹${(o.avgFillPaise / 100).toFixed(2)}` : ''} (${e.date === today ? `${rule.exit} exit` : 'late close'})`, now);
      } catch (err) { log('error', `Could not close ${l.label}: ${(err as Error).message}`, now); }
    }
    e.closedAt = now;
    if (e.date !== today) { e.clean = false; e.note = `Closed on ${today}: the app was not running at ${rule.exit} on ${e.date}. Left out of the results.`; }
    await save();
  }

  // 2. Entry
  if (!rule.enabled) return;
  const attempted = d.entries.some((e) => e.date === today) || d.events.some((e) => istDate(e.at) === today && e.action !== 'checked');
  if (attempted || min < hm(rule.entry) - 1) return;
  if (min > hm(rule.entry) + LATE_MIN) {
    if (!d.events.some((e) => istDate(e.at) === today)) { log('skipped', `The app was not ready by ${rule.entry} (+${LATE_MIN} min); no trade today`, now); await save(); }
    return;
  }
  const k = live.kite();
  if (!k) { log('error', 'Kite is not connected; no trade today', now); await save(); return; }
  const all = k.nfoContracts(rule.underlying).filter((c) => c.kind !== 'FUT' && c.expiry >= today);
  const expiry = [...new Set(all.map((c) => c.expiry))].sort()[0];
  if (!expiry) { log('skipped', 'No NIFTY option expiry ahead', now); await save(); return; }
  const spot = kiteMarket.underlyingPrice(rule.underlying);
  if (spot == null) return; // wait for a price until the late limit
  const chainOf = all.filter((c) => c.expiry === expiry);
  const atm = atmStrike([...new Set(chainOf.map((c) => c.strike * 100))], spot);
  if (atm == null) { log('error', `No strikes for ${expiry}`, now); await save(); return; }
  const legsC = (['CE', 'PE'] as const).map((kind) => chainOf.find((c) => c.kind === kind && c.strike * 100 === atm));
  const inst = legsC.map((c) => (c ? kiteMarket.instrument(c.tradingsymbol) : null));
  if (inst.some((i) => !i)) { log('error', `ATM ${atm / 100} call or put is not tradable`, now); await save(); return; }

  // arm a minute early so the two strikes are streaming, then place at the entry time
  if (armedOn !== today) { armedOn = today; armedAt = now; kiteMarket.watch(inst as NonNullable<(typeof inst)[number]>[]); return; }
  if (min < hm(rule.entry) || now - armedAt < ARM_WAIT_SEC) return;

  const dte = weekdaysTo(today, expiry);
  const entry: S920Entry = { date: today, expiry, dte, at: now, spotPaise: spot, legs: [], closedAt: null, clean: true, note: null };
  for (const i of inst as NonNullable<(typeof inst)[number]>[]) {
    const q = kiteMarket.quote(i);
    const leg: S920Leg = { symbol: i.symbol, label: i.label, kind: i.kind as 'CE' | 'PE', strikePaise: atm, bidPaise: q?.bidPaise ?? 0, askPaise: q?.askPaise ?? 0, orderId: null, fillPaise: null, stopPaise: null, stopOrderId: null };
    entry.legs.push(leg);
    try {
      const o = await lab.place({ symbol: i.symbol, side: 'SELL', product: 'NRML', type: 'MARKET', qty: rule.lots * i.lot, source: S920_SOURCE, ignoreWindow: true, reason: `${rule.name}: ${rule.entry} entry, ATM ${atm / 100} ${leg.kind}, expiry ${expiry} (${dte} DTE)` });
      leg.orderId = o.id; leg.fillPaise = o.avgFillPaise;
      log('placed', `Sold ${rule.lots} lot${rule.lots > 1 ? 's' : ''} ${i.label}${o.avgFillPaise != null ? ` at ₹${(o.avgFillPaise / 100).toFixed(2)}` : ''} (bid ₹${(leg.bidPaise / 100).toFixed(2)}, ask ₹${(leg.askPaise / 100).toFixed(2)}; spot ${(spot / 100).toFixed(2)}, ${dte} DTE)`, now);
      if (o.avgFillPaise) {
        leg.stopPaise = stopFor(o.avgFillPaise, rule.stopPct);
        try {
          const s = await lab.place({ symbol: i.symbol, side: 'BUY', product: 'NRML', type: 'SLM', qty: rule.lots * i.lot, triggerPaise: leg.stopPaise, source: S920_SOURCE, reason: `${rule.name}: ${rule.stopPct}% stop on ${leg.kind}` });
          leg.stopOrderId = s.id;
        } catch (err) {
          // the price is already past the stop: buy back now, as a triggered stop would
          log('error', `Stop at ₹${(leg.stopPaise / 100).toFixed(2)} not placed (${(err as Error).message}); buying back now`, now);
          await lab.exit(i.symbol, 'NRML', S920_SOURCE, `${rule.name}: stop hit at entry`).catch(() => undefined);
        }
      }
    } catch (err) {
      log('error', err instanceof LabError ? `Not placed: ${err.message}` : `Error: ${(err as Error).message}`, now);
    }
  }
  if (!entry.legs.some((l) => l.fillPaise)) { entry.closedAt = now; entry.clean = false; entry.note = 'Nothing filled'; }
  d.entries.push(entry);
  await save();
}

// ---------------------------------------------------------------- the report

export type S920Report = {
  rule: S920Rule;
  days: (Omit<S920Entry, 'legs'> & { legs: (S920Leg & { exitPaise: number | null; how: 'stop' | 'time' | 'open' | null })[]; netPaise: number | null; chargesPaise: number })[];
  byDte: { dte: number; days: number; won: number; netPaise: number; worstPaise: number }[];
  totals: { days: number; clean: number; won: number; netPaise: number; chargesPaise: number; stopsHit: number; bothStopped: number };
};

export async function s920Report(): Promise<S920Report> {
  const d = await load();
  const orders = (await prismaRepo.orders()).filter((o) => o.source === S920_SOURCE);
  const ids = new Set(orders.map((o) => o.id));
  const trades = (await prismaRepo.trades()).filter((t) => ids.has(t.orderId));
  const days: S920Report['days'] = [];
  for (const e of d.entries) {
    let net = 0, charges = 0, done = e.closedAt != null;
    const legs = e.legs.map((l) => {
      // this day's fills of the leg: from the entry to its close (the same contract can be traded again on a later day)
      const mine = trades.filter((t) => t.symbol === l.symbol && t.time >= e.at - 5 && (e.closedAt == null || t.time <= e.closedAt + 120));
      const sold = mine.filter((t) => t.side === 'SELL').reduce((a, t) => a + t.qty, 0), bought = mine.filter((t) => t.side === 'BUY').reduce((a, t) => a + t.qty, 0);
      const buy = mine.find((t) => t.side === 'BUY');
      const how = !l.fillPaise ? null : sold > bought ? 'open' : buy && l.stopOrderId && buy.orderId === l.stopOrderId ? 'stop' : 'time';
      if (how === 'open') done = false;
      net += mine.reduce((a, t) => a + (t.side === 'SELL' ? 1 : -1) * t.qty * t.pricePaise - t.chargesPaise, 0);
      charges += mine.reduce((a, t) => a + t.chargesPaise, 0);
      return { ...l, exitPaise: buy?.pricePaise ?? null, how: how as 'stop' | 'time' | 'open' | null };
    });
    days.push({ ...e, legs, netPaise: done ? net : null, chargesPaise: charges });
  }
  const clean = days.filter((x) => x.clean && x.netPaise != null);
  const by = new Map<number, S920Report['byDte'][number]>();
  for (const x of clean) {
    const r = by.get(x.dte) ?? { dte: x.dte, days: 0, won: 0, netPaise: 0, worstPaise: 0 };
    r.days++; if (x.netPaise! > 0) r.won++; r.netPaise += x.netPaise!; r.worstPaise = Math.min(r.worstPaise, x.netPaise!);
    by.set(x.dte, r);
  }
  const stops = clean.flatMap((x) => x.legs).filter((l) => l.how === 'stop').length;
  return {
    rule: d.rule, days: days.reverse(), byDte: [...by.values()].sort((a, b) => a.dte - b.dte),
    totals: { days: days.length, clean: clean.length, won: clean.filter((x) => x.netPaise! > 0).length, netPaise: clean.reduce((a, x) => a + x.netPaise!, 0), chargesPaise: clean.reduce((a, x) => a + x.chargesPaise, 0), stopsHit: stops, bothStopped: clean.filter((x) => x.legs.every((l) => l.how === 'stop')).length },
  };
}
