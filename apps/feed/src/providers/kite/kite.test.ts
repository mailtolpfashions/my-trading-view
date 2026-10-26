import { describe, expect, it } from 'vitest';
import { parseKiteCandles, parseKiteTime, weeklyFromDaily } from './provider';
import { checksum, sessionExpiry } from './session';
import { parsePacket, parseTicks } from './ticker';

const IST = 5.5 * 3600;
const ist = (y: number, mo: number, d: number, h = 0, m = 0) => Date.UTC(y, mo - 1, d, h, m) / 1000 - IST;

/** Builds packets exactly as Kite's WebSocket docs describe (big-endian int32 fields). */
function packet(fields: number[]): Buffer {
  const b = Buffer.alloc(fields.length * 4);
  fields.forEach((v, i) => b.writeInt32BE(v, i * 4));
  return b;
}
function message(packets: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.alloc(2)];
  parts[0].writeInt16BE(packets.length);
  for (const p of packets) { const len = Buffer.alloc(2); len.writeInt16BE(p.length); parts.push(len, p); }
  return Buffer.concat(parts);
}

describe('Kite WebSocket tick parsing', () => {
  it('parses an index packet in full mode (32 bytes): token, ltp, high, low, open, close, change, exchange time', () => {
    const t = parsePacket(packet([256265, 2275320, 2276045, 2238735, 2261015, 2260000, 15320, ist(2026, 10, 26, 15, 29)]));
    expect(t).toEqual({ token: 256265, ltpPaise: 2275320, highPaise: 2276045, lowPaise: 2238735, openPaise: 2261015, closePaise: 2260000, volume: null, time: ist(2026, 10, 26, 15, 29) });
  });

  it('parses an equity packet in full mode (184 bytes) using the documented offsets', () => {
    // token, ltp, last qty, avg price, volume, buy qty, sell qty, open, high, low, close, last trade time, oi, oi hi, oi lo, exch time, then 120 bytes of depth
    const head = packet([738561, 120180, 5, 119950, 14905641, 1000, 2000, 118400, 120190, 116310, 119000, ist(2026, 10, 26, 15, 29), 0, 0, 0, ist(2026, 10, 26, 15, 29)]);
    const t = parsePacket(Buffer.concat([head, Buffer.alloc(120)]));
    expect(t).toMatchObject({ token: 738561, ltpPaise: 120180, volume: 14905641, openPaise: 118400, highPaise: 120190, lowPaise: 116310, closePaise: 119000, time: ist(2026, 10, 26, 15, 29) });
  });

  it('reads several packets from one message and ignores 1-byte heartbeats and unknown sizes', () => {
    const msg = message([packet([1, 100, 0, 0, 0, 90, 10]), packet([2, 200])]);
    expect(parseTicks(msg).map((t) => [t.token, t.ltpPaise])).toEqual([[1, 100], [2, 200]]);
    expect(parseTicks(Buffer.from([0]))).toEqual([]);
    expect(parsePacket(Buffer.alloc(12))).toBeNull();
  });
});

describe('Kite historical candles', () => {
  it('parses Kite timestamps with the +0530 offset', () => {
    expect(parseKiteTime('2026-10-23T12:40:00+0530')).toBe(ist(2026, 10, 23, 12, 40));
  });
  it('keeps intraday times and re-stamps daily bars at 09:15 IST', () => {
    const intraday = parseKiteCandles([['2026-10-23T12:40:00+0530', 22418.8, 22423.2, 22407.55, 22409.7, 0]], false);
    expect(intraday[0]).toEqual({ time: ist(2026, 10, 23, 12, 40), open: 22418.8, high: 22423.2, low: 22407.55, close: 22409.7, volume: 0 });
    const daily = parseKiteCandles([['2026-10-23T00:00:00+0530', 1184, 1201.9, 1163.1, 1190, 14905641]], true);
    expect(daily[0].time).toBe(ist(2026, 10, 23, 9, 15));
  });
  it('builds Monday-anchored weekly bars from daily bars', () => {
    const d = (day: number, o: number, h: number, l: number, c: number, v: number) => ({ time: ist(2026, 10, day, 9, 15), open: o, high: h, low: l, close: c, volume: v });
    const w = weeklyFromDaily([d(21, 10, 12, 9, 11, 100), d(23, 11, 15, 10, 14, 200), d(26, 14, 14, 13, 13, 50)]); // Wed, Fri, next Mon
    expect(w).toEqual([
      { time: ist(2026, 10, 19, 9, 15), open: 10, high: 15, low: 9, close: 14, volume: 300 },
      { time: ist(2026, 10, 26, 9, 15), open: 14, high: 14, low: 13, close: 13, volume: 50 },
    ]);
  });
});

describe('Kite session', () => {
  it('checksum is SHA-256 of api_key + request_token + api_secret', () => {
    // sha256("abc") — the standard test vector
    expect(checksum('a', 'b', 'c')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('expires at 06:00 IST the next day (or the same day for a login before 06:00)', () => {
    expect(sessionExpiry(ist(2026, 10, 26, 22, 0))).toBe(ist(2026, 10, 27, 6, 0));
    expect(sessionExpiry(ist(2026, 10, 27, 5, 30))).toBe(ist(2026, 10, 27, 6, 0));
  });
});
