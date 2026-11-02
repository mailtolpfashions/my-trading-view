// Exit rules for the day-by-day simulator, applied to its result.

import type { SimResult } from './options';

/** Exit rules checked at each day's close (rupees; null = off). */
export type ExitRules = { stopLoss: number | null; target: number | null; exitDate: string | null };
export type Exit = { idx: number; reason: string };

/**
 * The first day after entry on which a rule fires, using P&L after charges if squared off at that day's close.
 * Exit date counts first on its day, then the stop loss, then the target. Null if nothing fires before the end.
 */
export function firstExit(r: SimResult, rules: ExitRules): Exit | null {
  for (let i = 1; i < r.days.length; i++) {
    const d = r.days[i];
    if (rules.exitDate && d.date >= rules.exitDate) return { idx: i, reason: 'Exit date' };
    if (rules.stopLoss != null && d.netIfExitPaise <= -rules.stopLoss * 100) return { idx: i, reason: 'Stop loss' };
    if (rules.target != null && d.netIfExitPaise >= rules.target * 100) return { idx: i, reason: 'Target' };
  }
  return null;
}
