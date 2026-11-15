// Experiment registry for the quant research programme. Every run appends one line to
// apps/feed/.data/research/experiments.jsonl with an ID, the strategy and its parameters, the data version it saw,
// the period and its role, the cost assumptions, the metrics and the validation evidence. Nothing is ever rewritten.
// Reports are built from this file (scripts/research/quant/report.ts).

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { prisma } from '@mtv/db';

export const RESEARCH_DIR = path.resolve(import.meta.dirname, '../../../.data/research');
export const QUANT_DIR = path.join(RESEARCH_DIR, 'quant');
const FILE = path.join(RESEARCH_DIR, 'experiments.jsonl');

export type DataVersion = { eodLast: string | null; fnoLast: string | null; fnoFirst: string | null; minutesLast: string | null; git: string; stamp: string };
export type Period = { from: string; to: string; role: 'train' | 'validation' | 'train+validation' | 'holdout' | 'walk-forward' | 'other' };
export type Experiment = {
  id: string; ranAt: string;
  /** Short name and the family it belongs to (A1, B9 … from docs/quant/01-audit-and-roadmap.md). */
  name: string; family: string; hypothesis: string; script: string;
  params: Record<string, unknown>;
  data: DataVersion;
  period: Period;
  costs: { broker: string; slippage: string; charges: 'itemised, dated' | string; notes?: string };
  /** Numbers the report reads; shape differs per family, so it is free-form but documented in the script. */
  metrics: Record<string, unknown>;
  validation: Record<string, unknown>;
  /** What is an estimate, what was skipped, what the data could not show. */
  caveats: string[];
  verdict: 'pass' | 'fail' | 'lead' | 'info';
  notes?: string;
};

let cachedVersion: DataVersion | null = null;
export async function dataVersion(): Promise<DataVersion> {
  if (cachedVersion) return cachedVersion;
  const eod = await prisma.equityEod.findFirst({ orderBy: { date: 'desc' }, select: { date: true } });
  const fnoLast = await prisma.fnoDayMeta.findFirst({ where: { underlying: 'NIFTY' }, orderBy: { date: 'desc' }, select: { date: true } });
  const fnoFirst = await prisma.fnoDayMeta.findFirst({ where: { underlying: 'NIFTY' }, orderBy: { date: 'asc' }, select: { date: true } });
  let minutesLast: string | null = null;
  try {
    const dir = path.resolve(import.meta.dirname, '../../../.data/1m/NIFTY');
    minutesLast = readdirSync(dir).filter((f) => f.endsWith('.bin')).sort().at(-1)?.replace('.bin', '') ?? null;
  } catch { /* no minutes */ }
  let git = 'unknown';
  try { git = execSync('git rev-parse --short HEAD', { cwd: path.resolve(import.meta.dirname, '../../../../..'), encoding: 'utf8' }).trim(); } catch { /* not a repo */ }
  cachedVersion = { eodLast: eod?.date ?? null, fnoLast: fnoLast?.date ?? null, fnoFirst: fnoFirst?.date ?? null, minutesLast, git, stamp: new Date().toISOString() };
  return cachedVersion;
}

export function readRegistry(): Experiment[] {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Experiment);
}

function nextId(): string {
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '');
  const n = readRegistry().filter((e) => e.id.startsWith(`E-${day}-`)).length + 1;
  return `E-${day}-${String(n).padStart(3, '0')}`;
}

/** Appends one experiment and returns its ID. */
export async function register(e: Omit<Experiment, 'id' | 'ranAt' | 'data'> & { data?: DataVersion }): Promise<string> {
  mkdirSync(RESEARCH_DIR, { recursive: true });
  mkdirSync(QUANT_DIR, { recursive: true });
  const full: Experiment = { id: nextId(), ranAt: new Date().toISOString(), data: e.data ?? (await dataVersion()), ...e } as Experiment;
  appendFileSync(FILE, JSON.stringify(full) + '\n');
  console.log(`registered ${full.id}: ${full.name} [${full.verdict}]`);
  return full.id;
}

/** Writes a large result (trades, curves) next to the registry, named by experiment ID. */
export function saveDetail(id: string, name: string, data: unknown) {
  mkdirSync(QUANT_DIR, { recursive: true });
  writeFileSync(path.join(QUANT_DIR, `${id}-${name}.json`), JSON.stringify(data));
}

export const COSTS = {
  nifty: { broker: 'zerodha', slippage: '₹1 per option per fill (assumed; no bid/ask history)', charges: 'itemised, dated' as const },
  banknifty: { broker: 'zerodha', slippage: '₹2 per option per fill (assumed)', charges: 'itemised, dated' as const },
  stocksLiquid: { broker: 'zerodha', slippage: '0.03% a side (assumed) on stocks with ≥ ₹10 crore average turnover', charges: 'itemised, dated' as const },
};
