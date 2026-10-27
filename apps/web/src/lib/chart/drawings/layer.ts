// Chart drawing layer: renders every drawing, the drawing in progress, the measure tool and alert lines on the main
// series, with price- and time-axis labels.
//
// NOTICE: adapted from TradingView Lightweight Charts™ plugin examples (trend-line, rectangle-drawing-tool,
// user-price-lines, vertical-line) and @tradingview/lwc-toolkit (PluginBase), Copyright (c) 2025 TradingView, Inc.,
// https://www.tradingview.com/, licensed under the Apache License 2.0
// (https://www.apache.org/licenses/LICENSE-2.0). Changed by My Trading View: merged into one layer for all drawing
// kinds, timeframe-independent point mapping, selection handles, measure tool, alert lines and our styling.

import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  Coordinate, IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView,
  Logical, PrimitivePaneViewZOrder, SeriesAttachedParameter, SeriesType, Time,
} from 'lightweight-charts';
import { timeToLogical, type Drawing, type Placed, type Point, type XY } from './model';

export type AlertLine = { price: number; label: string };
export type Measure = { from: Point; to: Point; text: string };

type LayerState = {
  drawings: Drawing[];
  preview: Drawing | null;
  measure: Measure | null;
  selected: string | null;
  alerts: AlertLine[];
  /** Ascending bar times (real UTC seconds) of the data on the chart. */
  times: number[];
};

const AMBER = '#ff9800';
const FONT = '600 11.5px "Plus Jakarta Sans", system-ui, sans-serif';
const fmtPrice = (p: number) => p.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const IST = 5.5 * 3600;
const fmtTime = (t: number) => {
  const d = new Date((t + IST) * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getUTCDate())} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
};
const withAlpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

/** Lifecycle shared by series primitives (from lwc-toolkit's PluginBase). */
abstract class PluginBase implements ISeriesPrimitive<Time> {
  private _chart?: IChartApi;
  private _series?: ISeriesApi<SeriesType>;
  private _requestUpdate?: () => void;
  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
    this.requestUpdate();
  }
  detached() { this._chart = undefined; this._series = undefined; this._requestUpdate = undefined; }
  protected requestUpdate() { this._requestUpdate?.(); }
  get chart() { return this._chart; }
  get series() { return this._series; }
}

class LayerRenderer implements IPrimitivePaneRenderer {
  constructor(private layer: DrawingLayer) {}
  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width, H = mediaSize.height;
      ctx.save();
      ctx.font = FONT;
      ctx.lineCap = 'round';
      for (const al of this.layer.state.alerts) {
        const y = this.layer.priceY(al.price);
        if (y == null) continue;
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, al.label, W - 6, y, AMBER, '#3d2c00', 'right');
      }
      const all = [...this.layer.state.drawings, ...(this.layer.state.preview ? [this.layer.state.preview] : [])];
      for (const pl of this.layer.placeAll(all)) drawOne(ctx, pl, W, H, pl.d.id === this.layer.state.selected);
      const m = this.layer.state.measure;
      if (m) {
        const a = this.layer.pointXY(m.from), b = this.layer.pointXY(m.to);
        if (a && b) {
          const up = m.to.price >= m.from.price;
          const col = up ? '#089981' : '#f23645';
          ctx.fillStyle = withAlpha(col, 0.14);
          ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          ctx.strokeStyle = col; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          label(ctx, m.text, (a.x + b.x) / 2, up ? Math.min(a.y, b.y) - 14 : Math.max(a.y, b.y) + 14, col, '#ffffff', 'center');
        }
      }
      ctx.restore();
    });
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string, fg: string, align: 'left' | 'right' | 'center') {
  const w = ctx.measureText(text).width + 12, h = 20;
  const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(left, y - h / 2, w, h, 5); ctx.fill();
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 6, y + 0.5);
}

function drawOne(ctx: CanvasRenderingContext2D, { d, a, b }: Placed, W: number, H: number, selected: boolean) {
  ctx.strokeStyle = d.color;
  ctx.lineWidth = selected ? 2.5 : 2;
  switch (d.kind) {
    case 'trend':
    case 'ray': {
      if (!b) break;
      let end = b;
      if (d.kind === 'ray' && b.x !== a.x) { // extend to the right edge (or the left, for a leftward ray)
        const edge = b.x > a.x ? W : 0;
        end = { x: edge, y: a.y + ((b.y - a.y) * (edge - a.x)) / (b.x - a.x) };
      }
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      break;
    }
    case 'hline':
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke();
      break;
    case 'vline':
      ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, H); ctx.stroke();
      break;
    case 'rect':
      if (!b) break;
      ctx.fillStyle = withAlpha(d.color, 0.12);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.lineWidth = selected ? 2 : 1.5;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      break;
    case 'text':
      ctx.font = '600 13px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillStyle = d.color;
      ctx.textBaseline = 'middle';
      ctx.fillText(d.text ?? '', a.x, a.y);
      if (selected) { ctx.lineWidth = 1; ctx.strokeRect(a.x - 4, a.y - 11, ctx.measureText(d.text ?? '').width + 8, 22); }
      ctx.font = FONT;
      break;
  }
  if (selected && d.kind !== 'hline' && d.kind !== 'vline' && d.kind !== 'text') {
    for (const p of [a, b]) if (p) {
      ctx.fillStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
}

class LayerPaneView implements IPrimitivePaneView {
  constructor(private layer: DrawingLayer) {}
  renderer() { return new LayerRenderer(this.layer); }
  zOrder(): PrimitivePaneViewZOrder { return 'top'; }
}

class AxisLabel implements ISeriesPrimitiveAxisView {
  constructor(private c: Coordinate, private t: string, private bg: string, private fg = '#ffffff') {}
  coordinate() { return this.c; }
  text() { return this.t; }
  textColor() { return this.fg; }
  backColor() { return this.bg; }
  visible() { return true; }
  tickVisible() { return true; }
}

/** One primitive for all drawings on the main series. Update its state with `set`; it redraws itself. */
export class DrawingLayer extends PluginBase {
  state: LayerState = { drawings: [], preview: null, measure: null, selected: null, alerts: [], times: [] };
  private views = [new LayerPaneView(this)];

  set(patch: Partial<LayerState>) {
    this.state = { ...this.state, ...patch };
    this.requestUpdate();
  }

  updateAllViews() { /* geometry is computed at draw time from the current scales */ }
  paneViews() { return this.views; }

  priceAxisViews() {
    const out: ISeriesPrimitiveAxisView[] = [];
    for (const d of this.state.drawings) {
      if (d.kind !== 'hline' && !(d.id === this.state.selected && (d.kind === 'trend' || d.kind === 'ray' || d.kind === 'rect'))) continue;
      for (const p of [d.p1, d.p2]) if (p) { const y = this.priceY(p.price); if (y != null) out.push(new AxisLabel(y as Coordinate, fmtPrice(p.price), d.color)); }
    }
    for (const al of this.state.alerts) { const y = this.priceY(al.price); if (y != null) out.push(new AxisLabel(y as Coordinate, fmtPrice(al.price), AMBER, '#3d2c00')); }
    return out;
  }

  timeAxisViews() {
    const out: ISeriesPrimitiveAxisView[] = [];
    const width = this.chart?.timeScale().width() ?? 0;
    for (const d of this.state.drawings) {
      if (d.kind !== 'vline' && d.id !== this.state.selected) continue;
      for (const p of [d.p1, d.p2]) if (p) {
        const x = this.timeX(p.time);
        if (x != null && x >= 0 && x <= width) out.push(new AxisLabel(x as Coordinate, fmtTime(p.time), d.color)); // off-screen points get no label
      }
    }
    return out;
  }

  // ---- coordinates ----
  priceY(price: number): number | null { return this.series?.priceToCoordinate(price) ?? null; }
  /**
   * x for a time. The chart only maps whole bar indices reliably, so fractional positions are interpolated from
   * bars 0 and 1 (bar spacing is uniform), the same mapping used to read clicks.
   */
  timeX(time: number): number | null {
    const logical = timeToLogical(this.state.times, time);
    const ts = this.chart?.timeScale();
    if (logical == null || !ts) return null;
    const x0 = ts.logicalToCoordinate(0 as Logical), x1 = ts.logicalToCoordinate(1 as Logical);
    if (x0 == null || x1 == null || !Number.isFinite(x0) || !Number.isFinite(x1)) return null;
    return x0 + logical * (x1 - x0);
  }
  pointXY(p: Point): XY | null {
    const x = this.timeX(p.time), y = this.priceY(p.price);
    return x == null || y == null ? null : { x, y };
  }
  placeAll(list: Drawing[]): Placed[] {
    const out: Placed[] = [];
    for (const d of list) {
      const a = d.kind === 'hline' ? (this.priceY(d.p1.price) == null ? null : { x: 0, y: this.priceY(d.p1.price)! }) : d.kind === 'vline' ? (this.timeX(d.p1.time) == null ? null : { x: this.timeX(d.p1.time)!, y: 0 }) : this.pointXY(d.p1);
      if (!a) continue;
      const b = d.p2 ? this.pointXY(d.p2) ?? undefined : undefined;
      out.push({ d, a, b });
    }
    return out;
  }
}
