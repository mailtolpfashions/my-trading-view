// Watches every active alert. Price alerts are checked every second against the price the user is entitled to
// (real-time for Live, 15 minutes behind for Free); indicator alerts are checked when their bars close.
// A firing is stored, pushed to the user's open browsers and emailed (when email is configured).

import { prisma } from '@mtv/db';
import { operandKey, type Condition, type RuleSet } from '@mtv/backtest';
import type { AlertEventMessage, Candle, Timeframe } from '@mtv/shared';
import type { Plan } from '@mtv/shared/feed-token';
import { barEnd, DELAY_SEC } from '../access';
import { priceCrossed, rulesFireOn, type PriceParams, type RulesParams } from './logic';
import { sendAlertEmail } from './mailer';

type AlertRow = { id: string; userId: string; symbol: string; kind: string; params: unknown; note: string | null; repeat: string; createdAt: Date; lastTriggeredAt: Date | null };

export type AlertDeps = {
  /** The latest price this plan may see (null if none yet), in rupees with its market time. */
  priceFor: (symbol: string, plan: Plan) => { price: number; time: number } | null;
  candles: (symbol: string, tf: Timeframe) => Promise<Candle[]>;
  /** Whether the current source is live (delayed sources are delayed for everyone). */
  liveSource: () => boolean;
  notify: (userId: string, event: AlertEventMessage) => void;
  now: () => number;
  log: (m: string) => void;
};

export const ALERT_LIMITS: Record<Plan, number> = { FREE: 5, LIVE: 50 };
const RULES_EVERY_SEC = 30;
const fmtRs = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const operandText = (o: Condition['left']) => (o.kind === 'number' ? String(o.value) : operandKey(o));
const OPS: Record<Condition['op'], string> = { crossesAbove: 'crossed above', crossesBelow: 'crossed below', '>': '>', '<': '<', '>=': '≥', '<=': '≤' };
export const describeRules = (r: RuleSet) => r.conditions.map((c) => `${operandText(c.left)} ${OPS[c.op]} ${operandText(c.right)}`).join(r.match === 'all' ? ' and ' : ' or ');

/** Same rule as the website's entitlement check: Live while a paid period has not ended. */
export async function planOf(userId: string): Promise<Plan> {
  const sub = await prisma.subscription.findFirst({ where: { userId, plan: 'LIVE', status: { in: ['ACTIVE', 'CANCELLED'] }, currentPeriodEnd: { gt: new Date() } }, select: { id: true } });
  return sub ? 'LIVE' : 'FREE';
}

export class AlertEngine {
  private active = new Map<string, AlertRow>();
  private lastPrice = new Map<string, number>(); // alert id → last price checked (paise)
  private plans = new Map<string, { plan: Plan; at: number }>();
  private nextRules = 0;
  private busy = false;

  constructor(private d: AlertDeps) {}

  async reload() {
    const rows = await prisma.alert.findMany({ where: { status: 'ACTIVE' }, select: { id: true, userId: true, symbol: true, kind: true, params: true, note: true, repeat: true, createdAt: true, lastTriggeredAt: true } });
    const ids = new Set(rows.map((r) => r.id));
    for (const id of this.lastPrice.keys()) if (!ids.has(id)) this.lastPrice.delete(id);
    this.active = new Map(rows.map((r) => [r.id, r]));
  }

  /** Symbols with active alerts (so the server keeps their prices fresh even when nobody is watching them). */
  symbols() { return [...new Set([...this.active.values()].map((a) => a.symbol))]; }

  private async plan(userId: string): Promise<Plan> {
    const c = this.plans.get(userId);
    if (c && this.d.now() - c.at < 60) return c.plan;
    const plan = await planOf(userId);
    this.plans.set(userId, { plan, at: this.d.now() });
    return plan;
  }

  /** Runs every second. */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const a of [...this.active.values()]) {
        if (a.kind !== 'PRICE') continue;
        const plan = await this.plan(a.userId);
        const q = this.d.priceFor(a.symbol, plan);
        if (!q) continue;
        const p = a.params as PriceParams, cur = Math.round(q.price * 100);
        const prev = this.lastPrice.get(a.id);
        this.lastPrice.set(a.id, cur);
        if (priceCrossed(p.op, p.valuePaise, prev, cur)) {
          const delayed = plan !== 'LIVE' && this.d.liveSource();
          await this.fire(a, cur, q.time, `${a.symbol} ${p.op === 'crossesAbove' ? 'crossed above' : 'crossed below'} ${fmtRs(p.valuePaise / 100)} (price ${fmtRs(q.price)})${delayed ? ' · 15-minute delayed data' : ''}`);
        }
      }
      if (this.d.now() >= this.nextRules) {
        this.nextRules = this.d.now() + RULES_EVERY_SEC;
        await this.checkRules();
      }
    } catch (e) {
      this.d.log(`Alert check failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async checkRules() {
    for (const a of [...this.active.values()]) {
      if (a.kind !== 'RULES') continue;
      const p = a.params as RulesParams;
      const plan = await this.plan(a.userId);
      const delayed = plan !== 'LIVE' && this.d.liveSource();
      const asOf = this.d.now() - (delayed ? DELAY_SEC : 0);
      let candles: Candle[];
      try { candles = await this.d.candles(a.symbol, p.tf); } catch { continue; }
      const bar = rulesFireOn(candles, p.tf, p.rules, asOf);
      if (!bar) continue;
      const closedAt = barEnd(bar, p.tf);
      // Only bars that closed after the alert was created, and each bar at most once (also across restarts).
      if (closedAt * 1000 <= a.createdAt.getTime()) continue;
      if (a.lastTriggeredAt && a.lastTriggeredAt.getTime() >= closedAt * 1000) continue;
      const tfLabel = p.tf === 'D' ? 'daily' : p.tf === '60' ? '1-hour' : `${p.tf}-minute`;
      await this.fire(a, Math.round(bar.close * 100), closedAt, `${a.symbol}: ${describeRules(p.rules)} on the ${tfLabel} bar (close ${fmtRs(bar.close)})${delayed ? ' · 15-minute delayed data' : ''}`, new Date(closedAt * 1000));
    }
  }

  private async fire(a: AlertRow, pricePaise: number, marketTime: number, message: string, triggeredFor?: Date) {
    const once = a.repeat === 'once';
    // Indicator alerts are stamped with the bar's close, so the same bar never fires twice, even after a restart.
    const stamp = triggeredFor ?? new Date(this.d.now() * 1000);
    const [event] = await prisma.$transaction([
      prisma.alertEvent.create({ data: { alertId: a.id, userId: a.userId, pricePaise, marketTime: new Date(marketTime * 1000), message, emailStatus: 'pending' } }),
      prisma.alert.update({ where: { id: a.id }, data: { lastTriggeredAt: stamp, ...(once && { status: 'TRIGGERED' }) } }),
    ]);
    if (once) this.active.delete(a.id);
    else this.active.set(a.id, { ...a, lastTriggeredAt: stamp });
    this.d.notify(a.userId, { id: event.id, alertId: a.id, symbol: a.symbol, message, price: pricePaise / 100, marketTime, triggeredAt: Math.floor(event.triggeredAt.getTime() / 1000) });
    this.d.log(`Alert ${a.id} fired: ${message}`);
    void (async () => {
      const user = await prisma.user.findUnique({ where: { id: a.userId }, select: { email: true } });
      const status = user ? await sendAlertEmail(user.email, `Alert: ${a.symbol}`, [message, ...(a.note ? [`Your note: ${a.note}`] : [])], this.d.log) : 'failed';
      await prisma.alertEvent.update({ where: { id: event.id }, data: { emailStatus: status } }).catch(() => {});
    })();
  }
}
