// Subscription billing rules shared by the payment providers: webhook verification and parsing (Razorpay), and how
// each billing event changes a stored subscription. Server-only: imported as '@mtv/shared/billing'.

import { createHmac, timingSafeEqual } from 'node:crypto';

export type BillingInterval = 'month' | 'year';
export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'HALTED' | 'CANCELLED';

/** A provider event, normalised. `charged` carries the payment that paid for the period ending at `periodEnd`. */
export type BillingEvent =
  | { kind: 'activated'; subscriptionId: string; periodEnd: Date | null }
  | { kind: 'charged'; subscriptionId: string; periodEnd: Date | null; payment: { id: string; amountPaise: number; currency: string } }
  | { kind: 'halted' | 'cancelled'; subscriptionId: string };

export type StoredSubscription = { status: SubscriptionStatus; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean };

/** The next state of a subscription after an event. Webhooks can arrive late, twice or out of order, so this is idempotent and never shortens paid access. */
export function applyBillingEvent(sub: StoredSubscription, e: BillingEvent): StoredSubscription {
  const later = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);
  switch (e.kind) {
    case 'activated':
      // A delayed "activated" must not revive a subscription the user already cancelled.
      return sub.status === 'CANCELLED' ? { ...sub, currentPeriodEnd: later(sub.currentPeriodEnd, e.periodEnd) } : { ...sub, status: 'ACTIVE', currentPeriodEnd: later(sub.currentPeriodEnd, e.periodEnd) };
    case 'charged':
      // Money was taken for a period: access runs to its end. A charge after HALTED means the retry succeeded.
      return { ...sub, status: sub.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE', currentPeriodEnd: later(sub.currentPeriodEnd, e.periodEnd) };
    case 'halted':
      return sub.status === 'CANCELLED' ? sub : { ...sub, status: 'HALTED' };
    case 'cancelled':
      return { ...sub, status: 'CANCELLED', cancelAtPeriodEnd: true };
  }
}

/** One billing period after `from`, in calendar months (31 Jan + 1 month = 28/29 Feb, never 2/3 Mar). */
export function addInterval(from: Date, interval: BillingInterval): Date {
  const months = interval === 'year' ? 12 : 1;
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Razorpay signs the raw webhook body with HMAC-SHA256 (hex) using the webhook secret. */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type RzpEntity<T> = { entity?: T };
type RzpWebhook = {
  event?: string;
  payload?: {
    subscription?: RzpEntity<{ id?: string; current_end?: number | null }>;
    payment?: RzpEntity<{ id?: string; amount?: number; currency?: string; status?: string }>;
  };
};

/** Normalises a Razorpay subscription webhook; null for events that do not change access. */
export function parseRazorpayEvent(body: RzpWebhook): BillingEvent | null {
  const sub = body.payload?.subscription?.entity;
  if (!sub?.id) return null;
  const periodEnd = typeof sub.current_end === 'number' ? new Date(sub.current_end * 1000) : null;
  switch (body.event) {
    case 'subscription.activated':
      return { kind: 'activated', subscriptionId: sub.id, periodEnd };
    case 'subscription.charged': {
      const p = body.payload?.payment?.entity;
      if (!p?.id || typeof p.amount !== 'number' || !Number.isInteger(p.amount)) return null;
      return { kind: 'charged', subscriptionId: sub.id, periodEnd, payment: { id: p.id, amountPaise: p.amount, currency: p.currency ?? 'INR' } };
    }
    case 'subscription.halted':
      return { kind: 'halted', subscriptionId: sub.id };
    case 'subscription.cancelled':
    case 'subscription.completed':
      return { kind: 'cancelled', subscriptionId: sub.id };
    default:
      return null; // pending (retrying a failed charge), authenticated, paused, updated...: access unchanged
  }
}
