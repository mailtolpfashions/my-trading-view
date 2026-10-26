import 'server-only';
import { randomUUID } from 'node:crypto';
import { prisma } from '@mtv/db';
import { addInterval, applyBillingEvent, type BillingEvent, type BillingInterval, type SubscriptionStatus } from '@mtv/shared/billing';
import { PLANS } from '@/lib/plans';

// Two providers behind one flow:
//  - sandbox: no money moves. A test checkout page plays the part of the payment gateway. Development only.
//  - razorpay: Razorpay Subscriptions (UPI Autopay / cards / e-mandate). Checkout on Razorpay's hosted page; access is
//    granted only by signed webhooks (/api/webhooks/billing/razorpay), never by the browser coming back.

export type BillingProvider = 'sandbox' | 'razorpay';
export const billingProvider = (): BillingProvider => (process.env.BILLING_PROVIDER === 'razorpay' ? 'razorpay' : 'sandbox');
const SANDBOX = 'billing-sandbox';

export class BillingError extends Error {}

async function razorpay<T>(path: string, body: unknown): Promise<T> {
  const id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new BillingError('Payments are not configured yet. Please try again later.');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
  if (!res.ok) throw new BillingError(json.error?.description ?? `Payment provider error (${res.status})`);
  return json;
}

/** Starts a Live subscription and returns where to send the user to pay. */
export async function startCheckout(userId: string, interval: BillingInterval): Promise<string> {
  if (billingProvider() === 'sandbox') {
    const sub = await prisma.subscription.create({
      data: { userId, plan: 'LIVE', interval, status: 'PENDING', provider: SANDBOX, providerSubscriptionId: `sbx_sub_${randomUUID()}` },
    });
    return `/billing/sandbox/${sub.id}`;
  }
  const planId = interval === 'year' ? process.env.RAZORPAY_PLAN_LIVE_YEAR : process.env.RAZORPAY_PLAN_LIVE_MONTH;
  if (!planId) throw new BillingError('Payments are not configured yet. Please try again later.');
  // total_count = number of renewals Razorpay may charge (10 years either way); the user can cancel any time.
  const rzp = await razorpay<{ id: string; short_url: string }>('/subscriptions', {
    plan_id: planId, total_count: interval === 'year' ? 10 : 120, quantity: 1, customer_notify: 1, notes: { userId },
  });
  await prisma.subscription.create({ data: { userId, plan: 'LIVE', interval, status: 'PENDING', provider: 'razorpay', providerSubscriptionId: rzp.id } });
  return rzp.short_url;
}

/** Applies a verified provider event to the stored subscription and records any payment exactly once. */
export async function recordBillingEvent(provider: string, e: BillingEvent): Promise<'applied' | 'unknown_subscription'> {
  return prisma.$transaction(async (tx) => {
    // Lock the row: two webhooks for the same subscription must apply one after the other, not overwrite each other.
    await tx.$executeRaw`SELECT 1 FROM "Subscription" WHERE "providerSubscriptionId" = ${e.subscriptionId} FOR UPDATE`;
    const sub =await tx.subscription.findUnique({ where: { providerSubscriptionId: e.subscriptionId } });
    if (!sub || sub.provider !== provider) return 'unknown_subscription';
    const next = applyBillingEvent({ status: sub.status as SubscriptionStatus, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd }, e);
    await tx.subscription.update({ where: { id: sub.id }, data: next });
    if (e.kind === 'charged') {
      await tx.payment.upsert({
        where: { paymentId: e.payment.id },
        create: { userId: sub.userId, provider, paymentId: e.payment.id, amountPaise: e.payment.amountPaise, currency: e.payment.currency },
        update: {},
      });
    }
    return 'applied';
  });
}

/** Sandbox gateway: "pay" for a pending test subscription (what a successful Razorpay charge webhook would do). */
export async function completeSandboxPayment(userId: string, subscriptionId: string) {
  if (billingProvider() !== 'sandbox') throw new BillingError('The test checkout is switched off.');
  const sub = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId, provider: SANDBOX, status: 'PENDING' } });
  if (!sub) throw new BillingError('Checkout not found.');
  const interval = sub.interval as BillingInterval;
  await recordBillingEvent(SANDBOX, {
    kind: 'charged',
    subscriptionId: sub.providerSubscriptionId,
    periodEnd: addInterval(new Date(), interval),
    payment: { id: `sbx_pay_${randomUUID()}`, amountPaise: PLANS.LIVE.pricePaise[interval], currency: 'INR' },
  });
}

/** Cancels renewal; paid access continues until the end of the current period. */
export async function cancelSubscription(userId: string) {
  const sub = await prisma.subscription.findFirst({ where: { userId, status: { in: ['ACTIVE', 'HALTED'] } }, orderBy: { createdAt: 'desc' } });
  if (!sub) throw new BillingError('You have no active subscription.');
  if (sub.provider === 'razorpay') {
    await razorpay(`/subscriptions/${sub.providerSubscriptionId}/cancel`, { cancel_at_cycle_end: sub.status === 'ACTIVE' ? 1 : 0 });
    // Razorpay sends subscription.cancelled when the cycle ends; until then access continues and renewal is off.
    await prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
  } else {
    await recordBillingEvent(SANDBOX, { kind: 'cancelled', subscriptionId: sub.providerSubscriptionId });
  }
}
