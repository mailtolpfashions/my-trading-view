// Kite WebSocket (KiteTicker) client: live ticks in "quote" mode, parsed from Kite's binary format as documented at
// kite.trade/docs/connect/v3/websocket. Prices arrive as integer paise.

import WebSocket from 'ws';

export type Tick = {
  token: number;
  ltpPaise: number;
  /** Previous day's close in paise. */
  closePaise: number;
  openPaise: number;
  highPaise: number;
  lowPaise: number;
  /** Day volume (equities only). */
  volume: number | null;
  /** Open interest (F&O in full mode only). */
  oi?: number;
  /** Last trade / exchange time, UTC epoch seconds (0 when the packet has none). */
  time: number;
};

/** Parses one binary message: [int16 count] then for each packet [int16 length][packet]. Heartbeats are 1 byte. */
export function parseTicks(buf: Buffer): Tick[] {
  if (buf.length < 2) return []; // heartbeat
  const count = buf.readInt16BE(0);
  const out: Tick[] = [];
  let off = 2;
  for (let i = 0; i < count && off + 2 <= buf.length; i++) {
    const len = buf.readInt16BE(off);
    const p = buf.subarray(off + 2, off + 2 + len);
    off += 2 + len;
    const t = parsePacket(p);
    if (t) out.push(t);
  }
  return out;
}

export function parsePacket(p: Buffer): Tick | null {
  const i32 = (o: number) => p.readInt32BE(o);
  if (p.length === 8) return { token: i32(0), ltpPaise: i32(4), closePaise: 0, openPaise: 0, highPaise: 0, lowPaise: 0, volume: null, time: 0 };
  if (p.length === 28 || p.length === 32) {
    // Index: token, ltp, high, low, open, close, change, [exchange timestamp]
    return { token: i32(0), ltpPaise: i32(4), highPaise: i32(8), lowPaise: i32(12), openPaise: i32(16), closePaise: i32(20), volume: null, time: p.length === 32 ? i32(28) : 0 };
  }
  if (p.length === 44 || p.length === 184) {
    // Equity/F&O: token, ltp, last qty, avg price, volume, buy qty, sell qty, open, high, low, close, [last trade time, OI …]
    const t: Tick = { token: i32(0), ltpPaise: i32(4), volume: i32(16), openPaise: i32(28), highPaise: i32(32), lowPaise: i32(36), closePaise: i32(40), time: p.length === 184 ? i32(44) : 0 };
    if (p.length === 184) t.oi = i32(48);
    return t;
  }
  return null; // unknown packet size: ignore rather than misread
}

/** Maintains one connection, re-subscribing after reconnects. Never more than 3000 tokens (Kite's per-connection cap). */
export class KiteTicker {
  private ws: WebSocket | null = null;
  /** Token → mode: "quote" (price, OHLC, volume) for the market; "full" adds OI, needed for option chains. */
  private tokens = new Map<number, 'quote' | 'full'>();
  private retry = 0;
  private closed = false;
  connected = false;

  constructor(private url: () => string | null, private onTicks: (t: Tick[]) => void, private log: (m: string) => void, private onAuthError: () => void) {}

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    this.ws?.close();
  }

  /** Subscribes new tokens (never more than Kite's 3,000), and upgrades already-subscribed ones to "full" when asked. */
  subscribe(tokens: number[], mode: 'quote' | 'full' = 'quote') {
    const fresh = tokens.filter((t) => !this.tokens.has(t)).slice(0, 3000 - this.tokens.size);
    const upgrade = mode === 'full' ? tokens.filter((t) => this.tokens.get(t) === 'quote') : [];
    fresh.forEach((t) => this.tokens.set(t, mode));
    upgrade.forEach((t) => this.tokens.set(t, 'full'));
    if (fresh.length) this.send(fresh, mode);
    if (upgrade.length) this.setMode(upgrade, 'full');
  }

  private send(tokens: number[], mode: 'quote' | 'full') {
    if (this.ws?.readyState !== WebSocket.OPEN || !tokens.length) return;
    this.ws.send(JSON.stringify({ a: 'subscribe', v: tokens }));
    this.setMode(tokens, mode);
  }

  private setMode(tokens: number[], mode: 'quote' | 'full') {
    if (this.ws?.readyState !== WebSocket.OPEN || !tokens.length) return;
    // "quote" mode: price, OHLC and volume (44 bytes), light enough to stream the whole market; "full" adds OI and depth.
    this.ws.send(JSON.stringify({ a: 'mode', v: [mode, tokens] }));
  }

  private connect() {
    const url = this.url();
    if (!url || this.closed) return;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on('open', () => {
      this.retry = 0;
      this.connected = true;
      this.log('Kite live feed connected');
      for (const mode of ['quote', 'full'] as const) this.send([...this.tokens].filter(([, m]) => m === mode).map(([t]) => t), mode);
    });
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const ticks = parseTicks(data);
        if (ticks.length) this.onTicks(ticks);
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      if (res.statusCode === 403) { this.log('Kite live feed: session expired, login required'); this.closed = true; this.onAuthError(); }
    });
    ws.on('error', (e) => this.log(`Kite live feed error: ${e.message}`));
    ws.on('close', () => {
      this.connected = false;
      if (this.closed) return;
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.log(`Kite live feed disconnected; reconnecting in ${wait / 1000}s`);
      setTimeout(() => this.connect(), wait);
    });
  }
}
