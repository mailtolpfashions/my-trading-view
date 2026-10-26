import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addInterval, applyBillingEvent, parseRazorpayEvent, verifyRazorpaySignature, type StoredSubscription } from './billing';

const d = (s: string) => new Date(s);
const pending: StoredSubscription = { status: 'PENDING', currentPeriodEnd: null, cancelAtPeriodEnd: false };
const charged = (end: string, id = 'pay_1') => ({ kind: 'charged' as const, subscriptionId: 'sub_1', periodEnd: d(end), payment: { id, amountPaise: 299900, currency: 'INR' } });

describe('subscription state', () => {
  it('a charge activates and sets the paid-until date', () => {
    expect(applyBillingEvent(pending, charged('2026-11-26T00:00:00Z'))).toEqual({ status: 'ACTIVE', currentPeriodEnd: d('2026-11-26T00:00:00Z'), cancelAtPeriodEnd: false });
  });
  it('a late, out-of-order event never shortens paid access', () => {
    const renewed = applyBillingEvent(applyBillingEvent(pending, charged('2026-11-26T00:00:00Z')), charged('2026-12-26T00:00:00Z', 'pay_2'));
    const late = applyBillingEvent(renewed, { kind: 'activated', subscriptionId: 'sub_1', periodEnd: d('2026-11-26T00:00:00Z') });
    expect(late.currentPeriodEnd).toEqual(d('2026-12-26T00:00:00Z'));
  });
  it('cancelling keeps access until the period end; a late "activated" does not undo it', () => {
    const active = applyBillingEvent(pending, charged('2026-11-26T00:00:00Z'));
    const cancelled = applyBillingEvent(active, { kind: 'cancelled', subscriptionId: 'sub_1' });
    expect(cancelled).toEqual({ status: 'CANCELLED', currentPeriodEnd: d('2026-11-26T00:00:00Z'), cancelAtPeriodEnd: true });
    expect(applyBillingEvent(cancelled, { kind: 'activated', subscriptionId: 'sub_1', periodEnd: null }).status).toBe('CANCELLED');
    expect(applyBillingEvent(cancelled, { kind: 'halted', subscriptionId: 'sub_1' }).status).toBe('CANCELLED');
  });
  it('a failed renewal halts; a successful retry reactivates', () => {
    const halted = applyBillingEvent(applyBillingEvent(pending, charged('2026-11-26T00:00:00Z')), { kind: 'halted', subscriptionId: 'sub_1' });
    expect(halted.status).toBe('HALTED');
    expect(applyBillingEvent(halted, charged('2026-12-26T00:00:00Z', 'pay_2')).status).toBe('ACTIVE');
  });
});

describe('billing periods', () => {
  it('adds calendar months without overflowing short months', () => {
    expect(addInterval(d('2026-01-31T10:00:00Z'), 'month')).toEqual(d('2026-02-28T10:00:00Z'));
    expect(addInterval(d('2028-01-31T10:00:00Z'), 'month')).toEqual(d('2028-02-29T10:00:00Z'));
    expect(addInterval(d('2026-10-26T10:00:00Z'), 'month')).toEqual(d('2026-11-26T10:00:00Z'));
    expect(addInterval(d('2028-02-29T10:00:00Z'), 'year')).toEqual(d('2029-02-28T10:00:00Z'));
  });
});

describe('Razorpay webhooks', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_X', current_end: 1795651200 } }, payment: { entity: { id: 'pay_X', amount: 299900, currency: 'INR' } } } });
  const sig = createHmac('sha256', secret).update(body).digest('hex');

  it('accepts only the exact signed body', () => {
    expect(verifyRazorpaySignature(body, sig, secret)).toBe(true);
    expect(verifyRazorpaySignature(body.replace('299900', '1'), sig, secret)).toBe(false);
    expect(verifyRazorpaySignature(body, sig, 'other')).toBe(false);
    expect(verifyRazorpaySignature(body, null, secret)).toBe(false);
    expect(verifyRazorpaySignature(body, sig, '')).toBe(false);
  });
  it('normalises subscription events', () => {
    expect(parseRazorpayEvent(JSON.parse(body))).toEqual({ kind: 'charged', subscriptionId: 'sub_X', periodEnd: new Date(1795651200 * 1000), payment: { id: 'pay_X', amountPaise: 299900, currency: 'INR' } });
    expect(parseRazorpayEvent({ event: 'subscription.completed', payload: { subscription: { entity: { id: 'sub_X' } } } })).toEqual({ kind: 'cancelled', subscriptionId: 'sub_X' });
    expect(parseRazorpayEvent({ event: 'subscription.pending', payload: { subscription: { entity: { id: 'sub_X' } } } })).toBeNull();
    expect(parseRazorpayEvent({ event: 'payment.captured', payload: {} })).toBeNull();
  });
});
