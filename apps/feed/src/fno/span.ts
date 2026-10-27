// NSE Clearing SPAN risk parameter files: download, parse the underlyings we use, and keep the latest in memory.
//
// Files are in NSE's public archive: nsccl.YYYYMMDD.i1 … i5 during the day (intraday updates) and nsccl.YYYYMMDD.s
// after the close (used from the next morning). They are standard SPAN 4 XML; we read only the combined commodities
// we need (risk arrays, deltas, calendar spread rates, short option minimum).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import type { SpanContract, SpanSpread, SpanUnderlying } from '@mtv/options';
import { nseGet, NotPublished } from '../nse-http';

export const SPAN_UNDERLYINGS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'] as const;

const spanUrl = (date: string, part: string) => `https://nsearchives.nseindia.com/archives/nsccl/span/nsccl.${date.replaceAll('-', '')}.${part}.zip`;

// ---- tiny XML helpers (the file is flat and machine-written) ----
function blocks(xml: string, tag: string, from = 0, to = xml.length): [number, number][] {
  const out: [number, number][] = [];
  const open = `<${tag}>`, close = `</${tag}>`;
  let i = xml.indexOf(open, from);
  while (i !== -1 && i < to) {
    const j = xml.indexOf(close, i);
    if (j === -1 || j > to) break;
    out.push([i + open.length, j]);
    i = xml.indexOf(open, j);
  }
  return out;
}
function value(xml: string, tag: string, from: number, to: number): string | undefined {
  const open = `<${tag}>`;
  const i = xml.indexOf(open, from);
  if (i === -1 || i >= to) return undefined;
  const j = xml.indexOf(`</${tag}>`, i);
  return xml.slice(i + open.length, j).trim();
}
function riskArray(xml: string, from: number, to: number): { ra: number[]; delta: number } | null {
  const [r] = blocks(xml, 'ra', from, to);
  if (!r) return null;
  const ra = blocks(xml, 'a', r[0], r[1]).map(([a, b]) => Number(xml.slice(a, b)));
  const d = Number(value(xml, 'd', r[0], r[1]));
  return ra.length === 16 && ra.every(Number.isFinite) && Number.isFinite(d) ? { ra, delta: d } : null;
}

/** Parses the combined commodities we use from a SPAN XML file. Throws if an underlying is missing or malformed. */
export function parseSpan(xml: string, file: string, wanted: readonly string[] = SPAN_UNDERLYINGS): Record<string, SpanUnderlying> {
  const created = value(xml, 'created', 0, 2000) ?? '';
  const out: Record<string, SpanUnderlying> = {};
  // Portfolio sections (phyPf / futPf / oopPf) by pfId.
  const pfById = new Map<string, { type: string; range: [number, number] }>();
  for (const type of ['phyPf', 'futPf', 'oopPf']) {
    for (const range of blocks(xml, type)) pfById.set(value(xml, 'pfId', range[0], range[1])!, { type, range });
  }
  for (const [cs, ce] of blocks(xml, 'ccDef')) {
    const cc = value(xml, 'cc', cs, ce);
    if (!cc || !wanted.includes(cc)) continue;
    const d: SpanUnderlying = { underlying: cc, file, created, spot: NaN, futures: {}, options: {}, spreads: [], somRate: 0 };
    for (const [ls, le] of blocks(xml, 'pfLink', cs, ce)) {
      const pf = pfById.get(value(xml, 'pfId', ls, le)!);
      if (!pf) throw new Error(`SPAN ${cc}: portfolio ${value(xml, 'pfId', ls, le)} not found`);
      const [ps, pEnd] = pf.range;
      if (pf.type === 'phyPf') d.spot = Number(value(xml, 'p', ps, pEnd));
      if (pf.type === 'futPf') {
        for (const [fs, fe] of blocks(xml, 'fut', ps, pEnd)) {
          const r = riskArray(xml, fs, fe);
          if (r) d.futures[value(xml, 'pe', fs, fe)!] = { ...r, price: Number(value(xml, 'p', fs, fe)) } satisfies SpanContract;
        }
      }
      if (pf.type === 'oopPf') {
        for (const [ss, se] of blocks(xml, 'series', ps, pEnd)) {
          const pe = value(xml, 'pe', ss, se)!;
          for (const [os, oe] of blocks(xml, 'opt', ss, se)) {
            const r = riskArray(xml, os, oe);
            if (r) d.options[`${pe}|${value(xml, 'o', os, oe)}|${Number(value(xml, 'k', os, oe)).toFixed(2)}`] = { ...r, price: Number(value(xml, 'p', os, oe)) };
          }
        }
      }
    }
    for (const [ss, se] of blocks(xml, 'dSpread', cs, ce)) {
      const rate = Number(value(xml, 'val', ss, se));
      const legs: SpanSpread['legs'] = blocks(xml, 'pLeg', ss, se).map(([a, b]) => ({ pe: value(xml, 'pe', a, b)!, side: value(xml, 'rs', a, b) as 'A' | 'B', ratio: Number(value(xml, 'i', a, b)) }));
      d.spreads.push({ rate, legs });
    }
    const [som] = blocks(xml, 'somTiers', cs, ce);
    if (som) d.somRate = Number(value(xml, 'val', som[0], som[1]) ?? 0);
    if (!Number.isFinite(d.spot) || !Object.keys(d.options).length) throw new Error(`SPAN ${cc}: no spot or no options in ${file}`);
    out[cc] = d;
  }
  for (const u of wanted) if (!out[u]) throw new Error(`SPAN file ${file} has no ${u}`);
  return out;
}

/** Downloads one SPAN file; null if NSE has not published it. */
export async function fetchSpan(date: string, part: string): Promise<Record<string, SpanUnderlying> | null> {
  try {
    const zip = unzipSync(new Uint8Array(await (await nseGet(spanUrl(date, part), 120_000)).arrayBuffer()));
    const name = Object.keys(zip).find((n) => n.endsWith('.spn'));
    if (!name) throw new Error(`no .spn file in ${spanUrl(date, part)}`);
    return parseSpan(strFromU8(zip[name]), name);
  } catch (e) {
    if (e instanceof NotPublished) return null;
    throw e;
  }
}

// ---- the file in force today ----
// Brokers margin with the start-of-day file (today's i1, published the previous night; the same figures as the
// previous trading day's end-of-day file). We use the same so our numbers match what a broker blocks.

const CACHE = path.resolve(import.meta.dirname, '../../.cache/span');
type SpanDay = { tradeDate: string; data: Record<string, SpanUnderlying> };
let current: SpanDay | null = null;
let loading: Promise<SpanDay | null> | null = null;
let lastTry = 0;
const istDate = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);

async function cached(key: string, load: () => Promise<Record<string, SpanUnderlying> | null>) {
  const file = path.join(CACHE, `${key}.json`);
  try { return JSON.parse(await readFile(file, 'utf8')) as Record<string, SpanUnderlying>; } catch { /* not cached */ }
  const data = await load();
  if (data) { await mkdir(CACHE, { recursive: true }); await writeFile(file, JSON.stringify(data)); }
  return data;
}

/** SPAN data for today's trading: today's start-of-day file, else the latest end-of-day file in the past week. */
export async function spanToday(nowMs = Date.now()): Promise<SpanDay | null> {
  const tradeDate = istDate(nowMs);
  const haveToday = current?.tradeDate === tradeDate && current.data.NIFTY?.file.includes(`.${tradeDate.replaceAll('-', '')}.i`);
  // Today's file not out yet (night, weekend, holiday): keep what we have and look again every 15 minutes.
  if (current && (haveToday || (current.tradeDate === tradeDate && nowMs - lastTry < 15 * 60_000))) return current;
  lastTry = nowMs;
  loading ??= (async () => {
    try {
      let data = await cached(`${tradeDate}-i1`, () => fetchSpan(tradeDate, 'i1'));
      for (let back = 1; !data && back <= 7; back++) {
        const d = istDate(nowMs - back * 86400_000);
        data = await cached(`${d}-s`, () => fetchSpan(d, 's'));
      }
      if (data) current = { tradeDate, data };
      return current;
    } finally {
      loading = null;
    }
  })();
  return loading;
}
