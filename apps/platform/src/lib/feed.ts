// Calls the data service through this app's /api/feed proxy. While the service is still loading NSE history it
// answers 503 "loading"; that is retried a few times before the message reaches the user.

export class FeedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function feed<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`/api/feed/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json as T;
    if (res.status === 503 && attempt < 20) { await new Promise((r) => setTimeout(r, 3000)); continue; }
    throw new FeedError(json.message ?? `Request failed (${res.status})`, res.status);
  }
}
