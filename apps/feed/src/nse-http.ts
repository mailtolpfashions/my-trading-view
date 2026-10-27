// Every download from NSE's archive goes through here, one request at a time with a gap between requests, so the
// background jobs together never hit NSE harder than a person clicking through the archive.

const MIN_GAP_MS = 2500;
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;

export class NotPublished extends Error {}

/** GET from NSE's archive; 404 (holiday / not yet published) throws NotPublished, other failures throw Error. */
export function nseGet(url: string, timeoutMs = 60_000): Promise<Response> {
  const run = async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) throw new NotPublished(`not published: ${url}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } finally {
      lastAt = Date.now();
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
