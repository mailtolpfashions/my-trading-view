// A copy of the in-memory NSE history on disk (apps/feed/.data/eod-snapshot.bin), so a restart loads it in seconds
// instead of reading every row back from Postgres. Postgres stays the record: the snapshot only says which days it
// holds and when it was written, and the loader reads from the database any day that is missing or saved later.
//
// Layout: 'MTVEOD1\n', u32 header length, header JSON (dates, ISINs, symbols and index names with bar counts),
// padding to 8 bytes, then columns: volume f64 per equity bar; date, ISIN, open, high, low, close, prev close
// (u32/i32) per equity bar; date, open, high, low, close per index bar. Bars are grouped by symbol, oldest first.

import fs from 'node:fs/promises';
import path from 'node:path';

export type SnapBar = { date: string; symbol: string; isin: string; openPaise: number; highPaise: number; lowPaise: number; closePaise: number; prevClosePaise: number; volume: number };
export type SnapIndexBar = { date: string; openPaise: number; highPaise: number; lowPaise: number; closePaise: number };
export type Snapshot = { writtenAt: number; dates: string[]; bySymbol: Map<string, SnapBar[]>; indexByName: Map<string, SnapIndexBar[]> };

type Header = { writtenAt: number; dates: string[]; isins: string[]; symbols: [string, number][]; indices: [string, number][] };

const MAGIC = 'MTVEOD1\n';
export const SNAPSHOT_FILE = path.resolve(import.meta.dirname, '../../.data/eod-snapshot.bin');

export function encodeSnapshot(s: Snapshot): Buffer {
  const dateIdx = new Map(s.dates.map((d, i) => [d, i]));
  const isins: string[] = [];
  const isinIdx = new Map<string, number>();
  let n = 0;
  for (const list of s.bySymbol.values()) n += list.length;
  let m = 0;
  for (const list of s.indexByName.values()) m += list.length;

  const vol = new Float64Array(n);
  const eq = new Int32Array(n * 7);
  const ix = new Int32Array(m * 5);
  let k = 0;
  for (const list of s.bySymbol.values()) {
    for (const b of list) {
      let ii = isinIdx.get(b.isin);
      if (ii === undefined) { ii = isins.length; isins.push(b.isin); isinIdx.set(b.isin, ii); }
      const d = dateIdx.get(b.date);
      if (d === undefined) throw new Error(`snapshot: bar date ${b.date} is not in the date list`);
      vol[k] = b.volume;
      eq.set([d, ii, b.openPaise, b.highPaise, b.lowPaise, b.closePaise, b.prevClosePaise], k * 7);
      k++;
    }
  }
  k = 0;
  for (const list of s.indexByName.values()) {
    for (const b of list) {
      const d = dateIdx.get(b.date);
      if (d === undefined) throw new Error(`snapshot: index date ${b.date} is not in the date list`);
      ix.set([d, b.openPaise, b.highPaise, b.lowPaise, b.closePaise], k * 5);
      k++;
    }
  }

  const header: Header = {
    writtenAt: s.writtenAt, dates: s.dates, isins,
    symbols: [...s.bySymbol].map(([sym, l]) => [sym, l.length]),
    indices: [...s.indexByName].map(([name, l]) => [name, l.length]),
  };
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const start = Math.ceil((MAGIC.length + 4 + json.length) / 8) * 8;
  const out = Buffer.alloc(start + vol.byteLength + eq.byteLength + ix.byteLength);
  out.write(MAGIC, 0, 'latin1');
  out.writeUInt32LE(json.length, MAGIC.length);
  json.copy(out, MAGIC.length + 4);
  Buffer.from(vol.buffer).copy(out, start);
  Buffer.from(eq.buffer).copy(out, start + vol.byteLength);
  Buffer.from(ix.buffer).copy(out, start + vol.byteLength + eq.byteLength);
  return out;
}

export function decodeSnapshot(file: Buffer): Snapshot {
  if (file.toString('latin1', 0, MAGIC.length) !== MAGIC) throw new Error('snapshot: unknown format');
  const len = file.readUInt32LE(MAGIC.length);
  const h = JSON.parse(file.toString('utf8', MAGIC.length + 4, MAGIC.length + 4 + len)) as Header;
  const start = Math.ceil((MAGIC.length + 4 + len) / 8) * 8;
  const n = h.symbols.reduce((a, [, c]) => a + c, 0);
  const m = h.indices.reduce((a, [, c]) => a + c, 0);
  if (file.length !== start + n * 8 + n * 28 + m * 20) throw new Error('snapshot: file is truncated');
  // Copy into a fresh buffer so the typed arrays start on aligned offsets.
  const ab = new Uint8Array(file.subarray(start)).buffer;
  const vol = new Float64Array(ab, 0, n);
  const eq = new Int32Array(ab, n * 8, n * 7);
  const ix = new Int32Array(ab, n * 8 + n * 28, m * 5);

  const bySymbol = new Map<string, SnapBar[]>();
  let k = 0;
  for (const [symbol, count] of h.symbols) {
    const list: SnapBar[] = new Array(count);
    for (let j = 0; j < count; j++, k++) {
      const o = k * 7;
      list[j] = { date: h.dates[eq[o]], symbol, isin: h.isins[eq[o + 1]], openPaise: eq[o + 2], highPaise: eq[o + 3], lowPaise: eq[o + 4], closePaise: eq[o + 5], prevClosePaise: eq[o + 6], volume: vol[k] };
    }
    bySymbol.set(symbol, list);
  }
  const indexByName = new Map<string, SnapIndexBar[]>();
  k = 0;
  for (const [name, count] of h.indices) {
    const list: SnapIndexBar[] = new Array(count);
    for (let j = 0; j < count; j++, k++) {
      const o = k * 5;
      list[j] = { date: h.dates[ix[o]], openPaise: ix[o + 1], highPaise: ix[o + 2], lowPaise: ix[o + 3], closePaise: ix[o + 4] };
    }
    indexByName.set(name, list);
  }
  return { writtenAt: h.writtenAt, dates: h.dates, bySymbol, indexByName };
}

export async function readSnapshot(file = SNAPSHOT_FILE): Promise<Snapshot | null> {
  const buf = await fs.readFile(file).catch(() => null);
  return buf ? decodeSnapshot(buf) : null;
}

/** Written to a temporary file and renamed, so a crash mid-write never leaves a broken snapshot. */
export async function writeSnapshot(s: Snapshot, file = SNAPSHOT_FILE): Promise<void> {
  const buf = encodeSnapshot(s);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, buf);
  await fs.rename(`${file}.tmp`, file);
}
