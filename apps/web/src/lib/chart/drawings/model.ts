// Chart drawings: what they are, how they map onto any timeframe, and how clicks find them. Pure functions only.
//
// Points are stored as (real UTC seconds, price). On screen a time becomes a fractional bar index ("logical")
// by interpolating between the bars around it, so a line drawn on a 5-minute chart lands on the same moment on a
// daily chart, and points beyond the last bar extend at the chart's bar interval.

export type Tool = 'cursor' | 'trend' | 'ray' | 'hline' | 'vline' | 'rect' | 'text' | 'measure' | 'alert';
export type DrawingKind = 'trend' | 'ray' | 'hline' | 'vline' | 'rect' | 'text';
export type Point = { time: number; price: number };
export type Drawing = { id: string; kind: DrawingKind; p1: Point; p2?: Point; text?: string; color: string };

/** Tools that need two clicks (start and end). */
export const TWO_POINT: Tool[] = ['trend', 'ray', 'rect', 'measure'];
export const COLORS = ['#2962ff', '#f23645', '#089981', '#ff9800', '#121212'];

/** Fractional bar index of `t` given ascending bar times. Before the first bar or past the last, extends at the edge interval. */
export function timeToLogical(times: number[], t: number): number | null {
  const n = times.length;
  if (!n) return null;
  if (n === 1) return t === times[0] ? 0 : null;
  if (t <= times[0]) return (t - times[0]) / (times[1] - times[0]);
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / (times[n - 1] - times[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  return lo + (t - times[lo]) / (times[hi] - times[lo]);
}

/** Inverse of timeToLogical. */
export function logicalToTime(times: number[], logical: number): number | null {
  const n = times.length;
  if (n < 2) return n ? times[0] : null;
  if (logical <= 0) return times[0] + logical * (times[1] - times[0]);
  if (logical >= n - 1) return times[n - 1] + (logical - (n - 1)) * (times[n - 1] - times[n - 2]);
  const i = Math.floor(logical);
  return times[i] + (logical - i) * (times[i + 1] - times[i]);
}

export type XY = { x: number; y: number };

/** Distance from point p to segment ab (or to the ray from a through b, when `ray`). */
export function distanceToSegment(p: XY, a: XY, b: XY, ray = false): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = ray ? Math.max(0, t) : Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Screen geometry of a drawing (null coordinates when off the chart's data). */
export type Placed = { d: Drawing; a: XY; b?: XY };

/** The drawing under the pointer (within `tol` pixels), topmost first. Rectangles are hit on their edges or inside. */
export function hitTest(placed: Placed[], p: XY, width: number, tol = 6): { id: string; handle: 'p1' | 'p2' | 'body' } | null {
  for (let i = placed.length - 1; i >= 0; i--) {
    const { d, a, b } = placed[i];
    if (Math.hypot(p.x - a.x, p.y - a.y) <= tol + 2 && d.kind !== 'hline' && d.kind !== 'vline') return { id: d.id, handle: 'p1' };
    if (b && Math.hypot(p.x - b.x, p.y - b.y) <= tol + 2) return { id: d.id, handle: 'p2' };
    const near =
      d.kind === 'hline' ? Math.abs(p.y - a.y) <= tol && p.x <= width
      : d.kind === 'vline' ? Math.abs(p.x - a.x) <= tol
      : d.kind === 'text' ? p.x >= a.x - tol && p.x <= a.x + Math.max(40, (d.text?.length ?? 0) * 7.5) && Math.abs(p.y - a.y) <= 12
      : d.kind === 'rect' && b ? p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol && p.y >= Math.min(a.y, b.y) - tol && p.y <= Math.max(a.y, b.y) + tol
      : b ? distanceToSegment(p, a, b, d.kind === 'ray') <= tol : false;
    if (near) return { id: d.id, handle: 'body' };
  }
  return null;
}

/** Readout for the measure tool, as TradingView shows it. */
export function measureText(from: Point, to: Point, bars: number): string {
  const dp = to.price - from.price;
  const pct = from.price ? (dp / from.price) * 100 : 0;
  const secs = Math.abs(to.time - from.time);
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.round((secs % 3600) / 60);
  const span = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  const sign = dp >= 0 ? '+' : '−';
  return `${sign}${Math.abs(dp).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${sign}${Math.abs(pct).toFixed(2)}%) · ${Math.round(bars)} bars · ${span}`;
}

// ---- saving (per symbol, in this browser) ----
const key = (symbol: string) => `mtv.drawings.v1.${symbol}`;
export function loadDrawings(symbol: string): Drawing[] {
  try {
    const raw = localStorage.getItem(key(symbol));
    const list = raw ? (JSON.parse(raw) as Drawing[]) : [];
    return Array.isArray(list) ? list.filter((d) => d && d.id && d.p1 && Number.isFinite(d.p1.price)) : [];
  } catch { return []; }
}
export function saveDrawings(symbol: string, list: Drawing[]) {
  try { if (list.length) localStorage.setItem(key(symbol), JSON.stringify(list)); else localStorage.removeItem(key(symbol)); } catch { /* storage unavailable */ }
}
export const newId = () => Math.random().toString(36).slice(2, 10);
