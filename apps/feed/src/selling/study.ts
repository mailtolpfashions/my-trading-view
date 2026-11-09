// Serves the option-selling study written by scripts/selling-study.ts. The study runs on its own because it holds years
// of option chains in memory; the service only reads its results.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '../../.data/research/selling');

type Config = { id: string; summary: { months?: unknown } & Record<string, unknown> } & Record<string, unknown>;
type Study = { configs: Config[] } & Record<string, unknown>;

let cached: { at: number; study: Study } | null = null;

async function load(): Promise<Study | null> {
  const raw = await readFile(path.join(DIR, 'summary.json'), 'utf8').catch(() => null);
  if (!raw) return null;
  const study = JSON.parse(raw) as Study;
  cached = { at: Date.now(), study };
  return study;
}

/** The whole study without each rule set's month rows, which only its own page needs. */
export async function studyOverview() {
  const study = cached && Date.now() - cached.at < 60_000 ? cached.study : await load();
  if (!study) return null;
  return { ...study, configs: study.configs.map((c) => { const { months: _m, ...summary } = c.summary; return { ...c, summary }; }) };
}

/** The premium decay curves and the table of every entry and exit. */
export const decayStudy = () => readFile(path.resolve(DIR, '../selling-decay.json'), 'utf8').then((s) => JSON.parse(s) as unknown, () => null);

/** Everything found so far, as one report for the app (built from the study logs). */
export const sellingThree = () => readFile(path.resolve(DIR, '../selling-three.json'), 'utf8').then((s) => JSON.parse(s) as unknown, () => null);
/** Research files written by scripts/selling-*.ts (selling-conclusion.ts writes conclusion and search-ui). */
const RESEARCH = new Set(['callratio', 'combo', 'weekly-buy', 'yearly', 'workshop', 'calendar', 'calendar-far', 'search-ui', 'conclusion']);
export const sellingResearch = (name: string) => (RESEARCH.has(name) ? readFile(path.resolve(DIR, `../selling-${name}.json`), 'utf8').then((s) => JSON.parse(s) as unknown, () => null) : Promise.resolve(null));
export const sellingReport = () => readFile(path.resolve(DIR, '../selling-report.json'), 'utf8').then((s) => JSON.parse(s) as unknown, () => null);

/** One rule set in full, with its trades. */
export async function studyDetail(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const study = cached?.study ?? await load();
  const config = study?.configs.find((c) => c.id === id);
  if (!config) return null;
  const run = await readFile(path.join(DIR, 'trades', `${id}.json`), 'utf8').catch(() => null);
  return run ? { config, ...JSON.parse(run) } : null;
}
