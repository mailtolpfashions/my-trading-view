// The quant research programme's results for the app: the experiment registry (apps/feed/.data/research/experiments.jsonl)
// and each experiment's detail file, put into one shape the report page can filter: a list of "settings", each with its
// parameters, its trades (entry, exit, net…) and/or its equity curve, plus any flat numbers the script saved for it.
// Read-only. Daily marks are heavy, so they come only when one setting is asked for.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const RESEARCH_DIR = path.resolve(import.meta.dirname, '../../.data/research');
const QUANT_DIR = path.join(RESEARCH_DIR, 'quant');
const SAFE = /^[A-Za-z0-9-]+$/;

export type QuantExperiment = {
  id: string; ranAt: string; name: string; family: string; hypothesis: string; script: string;
  params: Record<string, unknown>; data: Record<string, unknown>; period: { from: string; to: string; role: string };
  costs: Record<string, unknown>; metrics: Record<string, unknown>; validation: Record<string, unknown>; caveats: string[]; verdict: string; notes?: string;
  /** Detail files saved for it (name part of <id>-<name>.json). */
  details: string[];
};

export function quantExperiments(): QuantExperiment[] {
  const file = path.join(RESEARCH_DIR, 'experiments.jsonl');
  if (!existsSync(file)) return [];
  const files = existsSync(QUANT_DIR) ? readdirSync(QUANT_DIR).filter((f) => f.endsWith('.json')) : [];
  const list = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Omit<QuantExperiment, 'details'>);
  const out = list.map((e) => ({ ...e, details: files.filter((f) => f.startsWith(`${e.id}-`)).map((f) => f.slice(e.id.length + 1, -5)) }));
  // the holdout's trades were saved under a fixed name
  const holdout = out.find((e) => e.family === 'P12');
  if (holdout && files.includes('E-holdout-trades.json')) holdout.details.push('holdout:trades');
  return out;
}

export type QuantTrade = { entry: string; exit: string; net: number; worstMtm?: number; reason?: string; expiry?: string; symbol?: string; spotIn?: number; spotOut?: number; legs?: string[]; daily?: { date: string; mtm: number }[] };
export type QuantSetting = { index: number; id: string; params: Record<string, string | number | boolean>; skipped?: number; trades?: QuantTrade[]; curve?: [string, number][]; numbers?: Record<string, number> };
export type QuantDetail = { id: string; name: string; kind: 'settings' | 'curves' | 'trades' | 'combos' | 'curve'; settings: QuantSetting[] };

const flat = (o: unknown, prefix = '', out: Record<string, number> = {}): Record<string, number> => {
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[prefix + k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, `${prefix}${k}.`, out);
  }
  return out;
};
const paramsOf = (p: Record<string, unknown> | undefined): Record<string, string | number | boolean> => Object.fromEntries(Object.entries(p ?? {}).filter(([k, v]) => k !== 'id' && ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, v as string | number | boolean]));
/** A setting's name: the script's own id when it saved one, else its parameters joined. */
const idOf = (p: Record<string, string | number | boolean>, raw?: Record<string, unknown>) => (typeof raw?.id === 'string' ? raw.id : Object.values(p).join(' '));
const slim = (t: QuantTrade, daily: boolean): QuantTrade => (daily ? t : { ...t, daily: undefined });

/** One experiment's detail file, as settings. With `setting` set, only that setting, with its daily marks. */
export function quantDetail(id: string, name: string, setting?: number): QuantDetail | null {
  if (!SAFE.test(id) || !/^[a-z0-9:-]+$/.test(name)) return null;
  const file = name === 'holdout:trades' ? path.join(QUANT_DIR, 'E-holdout-trades.json') : path.join(QUANT_DIR, `${id}-${name}.json`);
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const daily = setting != null;
  let kind: QuantDetail['kind'] = 'settings';
  let settings: QuantSetting[] = [];
  if (name === 'holdout:trades') {
    kind = 'trades';
    settings = Object.entries(raw as Record<string, QuantTrade[]>).map(([book, trades], index) => ({ index, id: book, params: { book }, trades: trades.map((t) => slim(t, daily)) }));
  } else if (Array.isArray(raw) && raw.length && (raw[0] as { trades?: unknown }).trades && ((raw[0] as { p?: unknown }).p || (raw[0] as { s?: unknown }).s)) {
    settings = (raw as { p?: Record<string, unknown>; s?: Record<string, unknown>; skipped?: number; trades: QuantTrade[]; curve?: { date: string; equity: number }[] }[]).map((r, index) => {
      const params = paramsOf(r.p ?? r.s);
      return { index, id: idOf(params, r.p ?? r.s), params, skipped: r.skipped, trades: r.trades.map((t) => slim(t, daily)), ...(r.curve ? { curve: r.curve.map((c) => [c.date, c.equity] as [string, number]) } : {}) };
    });
  } else if (Array.isArray(raw) && raw.length && (raw[0] as { curve?: unknown }).curve) {
    kind = 'curves';
    settings = (raw as { p: Record<string, unknown>; curve: { date: string; equity: number }[] }[]).map((r, index) => { const params = paramsOf(r.p); return { index, id: idOf(params), params, curve: r.curve.map((c) => [c.date, c.equity] as [string, number]) }; });
  } else if (Array.isArray(raw) && raw.length && (raw[0] as { rule?: unknown }).rule) {
    kind = 'combos';
    // Curves and trades saved later for the same combinations (scripts/research/quant/a2-curves.ts), matched by rule, lots and stop.
    const sibling = path.join(QUANT_DIR, `${id}-curves.json`);
    const extra = existsSync(sibling) ? (JSON.parse(readFileSync(sibling, 'utf8')) as { p: { rule: string; lots: number; stopPct: number }; curve: { date: string; equity: number }[]; trades: QuantTrade[] }[]) : [];
    settings = (raw as Record<string, unknown>[]).map((r, index) => {
      const params = paramsOf({ rule: r.rule, lots: r.lots, stopPct: r.stopPct });
      const x = extra.find((e) => e.p.rule === r.rule && e.p.lots === r.lots && e.p.stopPct === r.stopPct);
      return { index, id: idOf(params), params, numbers: flat({ train: r.train, validation: r.validation, all: r.all, marginUsePct: r.marginUsePct, stopsHit: r.stopsHit, trades: r.trades, winRatePct: r.winRatePct }), ...(x ? { curve: x.curve.map((c) => [c.date, c.equity] as [string, number]), trades: x.trades } : {}) };
    });
  } else if (Array.isArray(raw) && raw.length && (raw[0] as { date?: unknown }).date && (raw[0] as { equity?: unknown }).equity != null) {
    kind = 'curve';
    settings = [{ index: 0, id: name, params: { curve: name }, curve: (raw as { date: string; equity: number }[]).map((c) => [c.date, c.equity] as [string, number]) }];
  } else if (Array.isArray(raw) && raw.length && (raw[0] as { entry?: unknown }).entry) {
    kind = 'trades';
    settings = [{ index: 0, id: name, params: { list: name }, trades: (raw as QuantTrade[]).map((t) => slim(t, daily)) }];
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.values(raw as Record<string, unknown>).every((v) => Array.isArray(v) && (v as { date?: unknown }[])[0]?.date)) {
    kind = 'curves';
    settings = Object.entries(raw as Record<string, { date: string; equity: number }[]>).map(([book, curve], index) => ({ index, id: book, params: { book }, curve: curve.map((c) => [c.date, c.equity] as [string, number]) }));
  } else return null;
  if (setting != null) settings = settings.filter((s) => s.index === setting);
  return { id, name, kind, settings };
}
