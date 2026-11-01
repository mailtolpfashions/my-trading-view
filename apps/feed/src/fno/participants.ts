// NSE's participant-wise open interest and trading volume in equity derivatives: how many contracts Clients
// (retail and other individuals), DIIs, FIIs and Pros (brokers' own trading) hold or traded each day, split by
// index/stock futures (long, short) and options (calls and puts, bought and sold). Published daily in NSE's archive
// (content/nsccl/fao_participant_oi_DDMMYYYY.csv and fao_participant_vol_DDMMYYYY.csv) since at least 2012.
// Downloaded politely through the shared NSE queue and stored as published; every file is checked (each column's
// TOTAL equals the sum of the four participant rows). Long ≠ short within NSE's own TOTAL row (e.g. 1 Feb 2018: one
// contract apart) is NSE's published figure, so it is kept as published and noted on that day, not rejected.

import { prisma } from '@mtv/db';
import { NotPublished, nseGet } from '../nse-http';
import { splitCsvLine } from '../official/nse-files';
import { datesToFetch } from './store';

export type ParticipantKind = 'oi' | 'vol';
export const PARTICIPANTS = ['Client', 'DII', 'FII', 'Pro'] as const;
export type Participant = (typeof PARTICIPANTS)[number];

const COLUMNS = {
  futIdxLong: 'FUTURE INDEX LONG', futIdxShort: 'FUTURE INDEX SHORT', futStkLong: 'FUTURE STOCK LONG', futStkShort: 'FUTURE STOCK SHORT',
  optIdxCallLong: 'OPTION INDEX CALL LONG', optIdxPutLong: 'OPTION INDEX PUT LONG', optIdxCallShort: 'OPTION INDEX CALL SHORT', optIdxPutShort: 'OPTION INDEX PUT SHORT',
  optStkCallLong: 'OPTION STOCK CALL LONG', optStkPutLong: 'OPTION STOCK PUT LONG', optStkCallShort: 'OPTION STOCK CALL SHORT', optStkPutShort: 'OPTION STOCK PUT SHORT',
  totalLong: 'TOTAL LONG CONTRACTS', totalShort: 'TOTAL SHORT CONTRACTS',
} as const;
export type ParticipantRow = { participant: Participant } & Record<keyof typeof COLUMNS, number>;

export function participantUrl(kind: ParticipantKind, date: string): string {
  const [y, m, d] = date.split('-');
  return `https://nsearchives.nseindia.com/content/nsccl/fao_participant_${kind}_${d}${m}${y}.csv`;
}

/** Parses one participant file. Throws on a format change or participant rows that do not add up to TOTAL. */
export function parseParticipants(csv: string, label = 'participant file'): { rows: ParticipantRow[]; notes: string[] } {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const h = lines.findIndex((l) => /^\s*client[ _]type\s*,/i.test(l)); // "CLIENT_TYPE" in 2012 files, "Client Type" later
  if (h < 0) throw new Error(`${label}: NSE participant file format changed: no "Client Type" header`);
  const header = splitCsvLine(lines[h]).map((x) => x.trim().toUpperCase());
  const idx = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${label}: NSE participant file format changed: column "${name}" not found`);
    return [k, i];
  })) as Record<keyof typeof COLUMNS, number>;
  const rows = new Map<string, Record<keyof typeof COLUMNS, number>>();
  for (const line of lines.slice(h + 1)) {
    const c = splitCsvLine(line);
    const who = (c[0] ?? '').trim();
    if (!who) continue;
    const vals = {} as Record<keyof typeof COLUMNS, number>;
    for (const k of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
      const v = Number((c[idx[k]] ?? '').replaceAll(',', '').trim());
      if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${label}: invalid number "${c[idx[k]]}" for ${who} ${COLUMNS[k]}`);
      vals[k] = v;
    }
    rows.set(who.toUpperCase(), vals);
  }
  const total = rows.get('TOTAL');
  if (!total) throw new Error(`${label}: NSE participant file format changed: no TOTAL row`);
  const out: ParticipantRow[] = PARTICIPANTS.map((p) => {
    const r = rows.get(p.toUpperCase());
    if (!r) throw new Error(`${label}: NSE participant file format changed: no ${p} row`);
    return { participant: p, ...r };
  });
  // NSE's own figures are often a contract or two apart (rounding in its file). Up to NSE_SLACK is noted and kept as
  // published; more than that means a misread column, so the file is rejected.
  const NSE_SLACK = 2;
  const notes: string[] = [];
  const check = (what: string, a: number, b: number) => {
    if (a === b) return;
    if (Math.abs(a - b) > NSE_SLACK) throw new Error(`${label}: inconsistent totals: ${what}: ${a} ≠ ${b}`);
    notes.push(`${what}: ${a} ≠ ${b}`);
  };
  for (const k of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) check(`${COLUMNS[k]} participants sum vs NSE TOTAL`, out.reduce((s, r) => s + r[k], 0), total[k]);
  const pairs: [keyof typeof COLUMNS, keyof typeof COLUMNS][] = [['futIdxLong', 'futIdxShort'], ['futStkLong', 'futStkShort'], ['optIdxCallLong', 'optIdxCallShort'], ['optIdxPutLong', 'optIdxPutShort'], ['optStkCallLong', 'optStkCallShort'], ['optStkPutLong', 'optStkPutShort'], ['totalLong', 'totalShort']];
  for (const [l, sh] of pairs) check(`NSE TOTAL ${COLUMNS[l]} vs ${COLUMNS[sh]}`, total[l], total[sh]);
  return { rows: out, notes };
}

async function recordFetch(date: string, status: string, message: string | null = null) {
  await prisma.participantFetch.upsert({ where: { date }, create: { date, status, message }, update: { status, message, attempts: { increment: 1 } } });
}

/** Downloads and stores both files for one day. NotPublished (no session that day) propagates. */
export async function fetchParticipantDay(date: string) {
  const data: { kind: ParticipantKind; rows: ParticipantRow[] }[] = [];
  const notes: string[] = [];
  for (const kind of ['oi', 'vol'] as const) {
    const csv = await (await nseGet(participantUrl(kind, date))).text();
    const parsed = parseParticipants(csv, `${date} ${kind}`);
    data.push({ kind, rows: parsed.rows });
    notes.push(...parsed.notes.map((n) => `${kind}: ${n}`));
  }
  const message = notes.length ? notes.join('; ') : null;
  await prisma.$transaction(async (tx) => {
    await tx.participantOi.deleteMany({ where: { date } });
    await tx.participantOi.createMany({
      data: data.flatMap(({ kind, rows }) => rows.map(({ participant, ...v }) => ({ date, kind, participant, ...Object.fromEntries(Object.entries(v).map(([k, n]) => [k, BigInt(n)])) }))) as never,
    });
    await tx.participantFetch.upsert({ where: { date }, create: { date, status: 'saved', message }, update: { status: 'saved', message, attempts: { increment: 1 } } });
  });
}

let running = false;

/** Fetches missing days, newest first. A format or consistency problem is recorded and skipped; a network problem pauses. */
export async function syncParticipants(from: string, log: (m: string) => void): Promise<void> {
  if (running) return;
  running = true;
  try {
    const done = new Set((await prisma.participantFetch.findMany({ where: { status: { in: ['saved', 'not-published'] } }, select: { date: true } })).map((f) => f.date));
    const todo = datesToFetch(from, Date.now() / 1000, true).filter((d) => !done.has(d)).reverse();
    if (todo.length) log(`Participant OI history: ${todo.length} days to download`);
    let saved = 0;
    for (const date of todo) {
      try {
        await fetchParticipantDay(date);
        saved++;
        if (saved % 50 === 0) log(`Participant OI history: ${saved}/${todo.length} days saved (latest ${date})`);
      } catch (e) {
        if (e instanceof NotPublished) { await recordFetch(date, 'not-published'); continue; }
        const msg = (e as Error).message;
        await recordFetch(date, 'error', msg);
        if (/format changed|inconsistent totals|invalid number/.test(msg)) { log(`Participant OI ${date}: ${msg}`); continue; }
        log(`Participant OI sync paused at ${date}: ${msg}. Retrying in 30 minutes.`);
        return;
      }
    }
    if (todo.length) log(`Participant OI history: up to date (${saved} new days)`);
  } finally {
    running = false;
  }
}

export function startParticipantSync(from: string, log: (m: string) => void) {
  const run = () => syncParticipants(from, log).catch((e) => log(`Participant OI sync failed, will retry: ${(e as Error).message.split('\n').slice(-2).join(' ')}`));
  setTimeout(run, 15_000);
  setInterval(run, 30 * 60_000);
}
