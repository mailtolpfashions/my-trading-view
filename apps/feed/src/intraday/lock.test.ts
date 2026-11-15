import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCK_STALE_MS, releaseLock, takeLock } from './lock';

const lockIn = async () => path.join(await mkdtemp(path.join(os.tmpdir(), 'live-lock-')), 'live.lock');
// The parent process is alive and is not us, like a reused id or a real second feed.
const other = process.ppid;

describe('live-data lock', () => {
  it('takes a missing lock', async () => {
    const f = await lockIn();
    expect(await takeLock(f)).toBeNull();
    expect(await readFile(f, 'utf8')).toBe(String(process.pid));
  });

  it('refuses a lock held by a live process that is heartbeating', async () => {
    const f = await lockIn();
    await writeFile(f, String(other));
    await expect(takeLock(f)).rejects.toThrow(`process ${other}`);
  });

  it('takes over a lock whose process id is alive but has not heartbeated (reused id)', async () => {
    const f = await lockIn();
    await writeFile(f, String(other));
    const old = new Date(Date.now() - LOCK_STALE_MS - 30_000);
    await utimes(f, old, old);
    expect(await takeLock(f)).toBe(other);
    expect(await readFile(f, 'utf8')).toBe(String(process.pid));
  });

  it('takes over a lock whose process has ended', async () => {
    const f = await lockIn();
    await writeFile(f, '999999');
    expect(await takeLock(f)).toBe(999999);
  });

  it('releases only its own lock', async () => {
    const f = await lockIn();
    await writeFile(f, String(other));
    await releaseLock(f);
    expect(existsSync(f)).toBe(true);
    await writeFile(f, String(process.pid));
    await releaseLock(f);
    expect(existsSync(f)).toBe(false);
  });
});
