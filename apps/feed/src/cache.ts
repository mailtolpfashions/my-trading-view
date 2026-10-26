/** Small TTL cache that also shares in-flight requests, so many browsers asking for the same data cause one upstream call. */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expires: number }>();
  private inflight = new Map<string, Promise<T>>();

  async get(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = load()
      .then((value) => {
        this.store.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
