// Only one process may stream and write minutes (two would race on the same files).
// The lock file holds the owner's process id, and the owner touches it every few seconds while it runs.
// A lock counts as held only when its process is alive AND it was touched recently: Windows reuses process ids,
// so a lock left by a crashed feed can point at an unrelated process (a browser tab, say).

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** A lock not touched for this long is stale, whatever process now has its id. */
export const LOCK_STALE_MS = 30_000;
/** How often the owner touches the lock. */
export const LOCK_TOUCH_MS = 10_000;

/** Takes the lock, or throws if another live process holds it. Returns the id of a stale owner it replaced, if any. */
export async function takeLock(file: string, pid = process.pid, now = Date.now()): Promise<number | null> {
  const other = Number(await readFile(file, 'utf8').catch(() => '0'));
  let replaced: number | null = null;
  if (other && other !== pid) {
    let alive = true;
    try { process.kill(other, 0); } catch { alive = false; }
    const touched = (await stat(file).catch(() => null))?.mtimeMs ?? 0;
    if (alive && now - touched < LOCK_STALE_MS) throw new Error(`Another data service (process ${other}) is already streaming live data`);
    replaced = other;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, String(pid));
  return replaced;
}

/** Marks the lock as still in use (rewrites it, so a lock removed by a stop that raced a restart comes back). */
export async function touchLock(file: string, pid = process.pid) {
  await writeFile(file, String(pid));
}

/** Removes the lock if it is ours. */
export async function releaseLock(file: string, pid = process.pid) {
  const owner = Number(await readFile(file, 'utf8').catch(() => '0'));
  if (owner === pid) await rm(file, { force: true });
}

/** Same as releaseLock, for process 'exit' handlers (which cannot wait). */
export function releaseLockSync(file: string, pid = process.pid) {
  try { if (Number(readFileSync(file, 'utf8')) === pid) rmSync(file, { force: true }); } catch { /* no lock */ }
}
