// Minimal reader for legacy Excel 97–2003 workbooks (.xls: a Compound File holding a BIFF8 "Workbook" stream), enough
// for NSE's published tables (e.g. content/fo/fii_stats_DD-Mon-YYYY.xls). Reads the first worksheet's cell values:
// shared strings, inline labels, numbers and RK / MULRK numbers. Formulas are read from their cached numeric result.
// Anything unexpected throws, so a format change fails loudly instead of returning wrong numbers.

export type Cell = string | number | null;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const i32 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const f64 = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, true);

// ---- Compound File (CFB) ----
const ENDOFCHAIN = 0xfffffffe, FREESECT = 0xffffffff;

/** The named stream's bytes from a Compound File (e.g. "Workbook"). */
export function cfbStream(file: Uint8Array, name: string): Uint8Array {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!sig.every((v, i) => file[i] === v)) throw new Error('xls: not a Compound File (old Excel format expected)');
  const sectorSize = 1 << u16(file, 0x1e), miniSize = 1 << u16(file, 0x20);
  const dirStart = u32(file, 0x30), miniCutoff = u32(file, 0x38), miniFatStart = u32(file, 0x3c), miniFatCount = u32(file, 0x40);
  let difatSector = u32(file, 0x44);
  const sectorAt = (n: number) => 512 + n * sectorSize;
  // DIFAT: the first 109 FAT sector numbers are in the header, the rest in a chain of DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) { const s = u32(file, 0x4c + i * 4); if (s !== FREESECT) fatSectors.push(s); }
  for (let guard = 0; difatSector !== ENDOFCHAIN && difatSector !== FREESECT && guard < 10000; guard++) {
    const base = sectorAt(difatSector), per = sectorSize / 4 - 1;
    for (let i = 0; i < per; i++) { const s = u32(file, base + i * 4); if (s !== FREESECT) fatSectors.push(s); }
    difatSector = u32(file, base + per * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(file, sectorAt(s) + i * 4));
  const chain = (start: number, next: number[]) => {
    const out: number[] = [];
    for (let s = start; s !== ENDOFCHAIN && out.length <= next.length; s = next[s]) {
      if (s === undefined || s === FREESECT) throw new Error('xls: broken sector chain');
      out.push(s);
    }
    return out;
  };
  const read = (start: number) => { const parts = chain(start, fat).map((s) => file.subarray(sectorAt(s), sectorAt(s) + sectorSize)); const all = new Uint8Array(parts.length * sectorSize); parts.forEach((p, i) => all.set(p, i * sectorSize)); return all; };
  const dir = read(dirStart);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = u16(dir, o + 0x40);
    const name = String.fromCharCode(...Array.from({ length: Math.max(0, len / 2 - 1) }, (_, i) => u16(dir, o + i * 2)));
    entries.push({ name, type: dir[o + 0x42], start: u32(dir, o + 0x74), size: u32(dir, o + 0x78) });
  }
  const entry = entries.find((e) => e.type === 2 && e.name.toLowerCase() === name.toLowerCase());
  if (!entry) throw new Error(`xls: no "${name}" stream in the file`);
  if (entry.size >= miniCutoff) return read(entry.start).subarray(0, entry.size);
  // Small streams live in the mini stream (inside the root entry), addressed through the mini FAT.
  const root = entries.find((e) => e.type === 5);
  if (!root) throw new Error('xls: no root entry');
  const miniStream = read(root.start);
  const miniFatBytes = miniFatCount ? read(miniFatStart) : new Uint8Array();
  const miniFat = Array.from({ length: miniFatBytes.length / 4 }, (_, i) => u32(miniFatBytes, i * 4));
  const parts = chain(entry.start, miniFat).map((s) => miniStream.subarray(s * miniSize, (s + 1) * miniSize));
  const all = new Uint8Array(parts.length * miniSize);
  parts.forEach((p, i) => all.set(p, i * miniSize));
  return all.subarray(0, entry.size);
}

// ---- BIFF8 ----
function rk(v: number): number {
  const div100 = v & 1, isInt = v & 2;
  let n: number;
  if (isInt) n = v >> 2;
  else { const b = new Uint8Array(8); new DataView(b.buffer).setUint32(4, v & 0xfffffffc, true); n = new DataView(b.buffer).getFloat64(0, true); }
  return div100 ? n / 100 : n;
}

/** Shared strings from an SST record and its CONTINUE records (strings may split across them). */
function readSst(parts: Uint8Array[]): string[] {
  let pi = 0, o = 8; // skip cstTotal, cstUnique
  const out: string[] = [];
  const unique = u32(parts[0], 4);
  const need = (n: number) => { if (o + n > parts[pi].length) { pi++; o = 0; if (pi >= parts.length) throw new Error('xls: SST ends early'); } };
  for (let k = 0; k < unique; k++) {
    need(3);
    const cch = u16(parts[pi], o), flags = parts[pi][o + 2]; o += 3;
    let high = flags & 1;
    const rich = flags & 8 ? u16(parts[pi], o) : 0; if (flags & 8) o += 2;
    const ext = flags & 4 ? u32(parts[pi], o) : 0; if (flags & 4) o += 4;
    let s = '', left = cch;
    while (left > 0) {
      if (o >= parts[pi].length) { pi++; o = 0; high = parts[pi][o] & 1; o += 1; } // a CONTINUE restarts with a flags byte
      const avail = Math.min(left, Math.floor((parts[pi].length - o) / (high ? 2 : 1)));
      for (let i = 0; i < avail; i++) s += String.fromCharCode(high ? u16(parts[pi], o + i * 2) : parts[pi][o + i]);
      o += avail * (high ? 2 : 1); left -= avail;
    }
    let skip = rich * 4 + ext; // formatting runs and extended data: not needed
    while (skip > 0) { const step = Math.min(skip, parts[pi].length - o); o += step; skip -= step; if (skip > 0) { pi++; o = 0; } }
    out.push(s);
  }
  return out;
}

/** The first worksheet's cells as rows × columns (rows and columns as in the sheet, empty cells null). */
export function readXlsFirstSheet(file: Uint8Array): Cell[][] {
  const wb = cfbStream(file, 'Workbook');
  const records: { type: number; data: Uint8Array }[] = [];
  for (let o = 0; o + 4 <= wb.length;) {
    const type = u16(wb, o), len = u16(wb, o + 2);
    records.push({ type, data: wb.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  let sst: string[] = [];
  const sheets: number[] = []; // stream offsets of worksheets, from BOUNDSHEET records
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.type === 0x00fc) { const parts = [r.data]; while (records[i + 1]?.type === 0x003c) parts.push(records[++i].data); sst = readSst(parts); }
    if (r.type === 0x0085 && r.data[5] === 0) sheets.push(u32(r.data, 0)); // worksheet (not chart / macro)
  }
  if (!sheets.length) throw new Error('xls: no worksheet');
  // Walk records again from the first worksheet's BOF.
  const grid: Cell[][] = [];
  const set = (row: number, col: number, v: Cell) => { (grid[row] ??= [])[col] = v; };
  let o = sheets[0], inSheet = false;
  for (; o + 4 <= wb.length;) {
    const type = u16(wb, o), len = u16(wb, o + 2), d = wb.subarray(o + 4, o + 4 + len);
    o += 4 + len;
    if (type === 0x0809) { inSheet = true; continue; } // BOF
    if (!inSheet) continue;
    if (type === 0x000a) break; // EOF of the sheet
    if (type === 0x00fd) set(u16(d, 0), u16(d, 2), sst[u32(d, 6)] ?? null); // LABELSST
    else if (type === 0x0203) set(u16(d, 0), u16(d, 2), f64(d, 6)); // NUMBER
    else if (type === 0x027e) set(u16(d, 0), u16(d, 2), rk(i32(d, 6))); // RK
    else if (type === 0x00bd) { // MULRK
      const row = u16(d, 0), first = u16(d, 2), last = u16(d, len - 2);
      for (let c = first; c <= last; c++) set(row, c, rk(i32(d, 4 + (c - first) * 6 + 2)));
    } else if (type === 0x0204) { // LABEL (older string cell)
      const cch = u16(d, 6), high = d[8] & 1;
      set(u16(d, 0), u16(d, 2), String.fromCharCode(...Array.from({ length: cch }, (_, i) => (high ? u16(d, 9 + i * 2) : d[9 + i]))));
    } else if (type === 0x0006) { // FORMULA: cached numeric result unless the top bytes mark a string/bool/error
      if (!(d[12] === 0xff && d[13] === 0xff)) set(u16(d, 0), u16(d, 2), f64(d, 6));
    }
  }
  return Array.from({ length: grid.length }, (_, r) => Array.from({ length: grid[r]?.length ?? 0 }, (_, c) => grid[r]?.[c] ?? null));
}
