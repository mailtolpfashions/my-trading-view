// A playbook is one complete way of managing a sold position: when to take profit, when to get out, and how to adjust.
// The study tests each of these on NSE's history; only one that passes can ever reach the advisor.

export type Trigger = { on: 'delta'; multiple: number } | { on: 'strike' } | { on: 'breakeven' };
export type AdjustAction = 'roll-safe-in' | 'roll-tested-out' | 'add-hedge' | 'go-straddle';

export type Playbook = {
  id: string;
  name: string;
  /** Exit when this % of the entry credit has been earned. */
  profitTakePct?: number;
  /** Exit everything once this many calendar days are left to the nearest short's expiry. */
  exitDaysLeft?: number;
  /** Exit everything at a loss of this multiple of the entry credit. */
  stopMultiple?: number;
  /** The last line: no adjustment can go past a loss of this multiple of the entry credit. */
  maxLossMultiple?: number;
  adjust?: { action: AdjustAction; trigger: Trigger; maxAdjustments: number };
};

export type SellEntry = {
  /** Which expiries to sell: month-end or the nearest weekly. */
  cycle: 'monthly' | 'weekly';
  /** Enter this many trading days before expiry. */
  daysBefore: number;
  /** Enter on the first trading day within this many calendar days of expiry. Replaces daysBefore when set. */
  calendarDaysBefore?: number;
  /** Short strikes: nearest this delta (0.16 = about 16%), or a fixed number of strikes out of the money. */
  short: { delta: number } | { stepsOtm: number };
  /** Protection bought this % of the index beyond each short strike. Null sells naked. */
  wingPct: number | null;
  /** One put bought this % below the index as crash protection, far beyond the short. */
  crashPutPct?: number;
  lots: number;
};

/**
 * The rule going to paper trading: chosen from the study on the user's goal, not on promises. Sell a 0.16 delta strangle
 * about 45 days before a monthly expiry, only when IV is above its past-year median; buy a put 15% below the index; exit
 * everything at 21 days left. Tested in scripts/selling-rule.ts.
 */
export const PAPER_RULE: { entry: SellEntry; playbook: Playbook } = {
  entry: { cycle: 'monthly', daysBefore: 0, calendarDaysBefore: 45, short: { delta: 0.16 }, wingPct: null, crashPutPct: 15, lots: 1 },
  playbook: { id: 'paper-rule', name: 'High IV, 45 to 21 days', exitDaysLeft: 21 },
};

/**
 * The second paper rule, run beside the first to compare them. Chosen on the years up to 2022 and checked on 2023 to today
 * in scripts/selling-straddle.ts: sell the straddle at the forward about 45 days out, only in the top third of the past
 * year's IV, book 50% of the credit, otherwise exit at 25 days left. It has no protection.
 */
export const PAPER_STRADDLE = {
  calendarDaysBefore: 45,
  minIvRank: 0.67,
  playbook: { id: 'paper-straddle', name: 'Straddle, top third of IV, 45 to 25 days', exitDaysLeft: 25, profitTakePct: 50 } as Playbook,
};

/** Distance of protection added later to a naked position, % of the index beyond the short. */
export const ADDED_WING_PCT = 2;

const CAP = 3; // adjusting playbooks stop at a loss of 3 × the credit
const TRIGGERS: Record<string, Trigger> = { delta: { on: 'delta', multiple: 2 }, strike: { on: 'strike' }, breakeven: { on: 'breakeven' } };
const TRIGGER_WORDS: Record<string, string> = { delta: 'delta doubles', strike: 'strike touched', breakeven: 'breakeven touched' };
const ACTIONS: { id: AdjustAction; name: string; max: number }[] = [
  { id: 'roll-safe-in', name: 'Roll safe side in', max: 2 },
  { id: 'roll-tested-out', name: 'Roll tested side out', max: 2 },
  { id: 'add-hedge', name: 'Add protection', max: 2 },
  { id: 'go-straddle', name: 'Move to straddle', max: 1 },
];

/** Every playbook in the study. "Hold" is the baseline and alone has no loss limit, to show the plain truth. */
export const PLAYBOOKS: Playbook[] = [
  { id: 'hold', name: 'Hold to expiry' },
  { id: 'book-50', name: 'Book 50% profit', profitTakePct: 50, maxLossMultiple: CAP },
  { id: 'stop-2x', name: 'Stop at 2× credit', stopMultiple: 2 },
  ...ACTIONS.flatMap((a) => Object.keys(TRIGGERS).map((t): Playbook => ({
    id: `${a.id}-${t}`, name: `${a.name} when ${TRIGGER_WORDS[t]}`, maxLossMultiple: CAP,
    adjust: { action: a.id, trigger: TRIGGERS[t], maxAdjustments: a.max },
  }))),
];
