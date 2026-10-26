import { NextResponse } from 'next/server';
import { parseRazorpayEvent, verifyRazorpaySignature } from '@mtv/shared/billing';
import { recordBillingEvent } from '@/server/billing';

export const dynamic = 'force-dynamic';

/** Razorpay subscription webhooks. Only signed events change access; unknown or irrelevant events are acknowledged. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (provider !== 'razorpay') return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
  const raw = await req.text(); // the signature covers the exact bytes, so verify before parsing
  if (!verifyRazorpaySignature(raw, req.headers.get('x-razorpay-signature'), process.env.RAZORPAY_WEBHOOK_SECRET ?? '')) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }
  let event;
  try {
    event = parseRazorpayEvent(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: 'bad_body' }, { status: 400 });
  }
  if (!event) return NextResponse.json({ ok: true, ignored: true });
  const result = await recordBillingEvent('razorpay', event);
  if (result === 'unknown_subscription') console.warn(`Billing webhook for unknown subscription ${event.subscriptionId}`);
  return NextResponse.json({ ok: true, result });
}
