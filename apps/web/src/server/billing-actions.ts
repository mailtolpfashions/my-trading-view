'use server';

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { BillingError, cancelSubscription, completeSandboxPayment, startCheckout } from '@/server/billing';
import { currentPlan } from '@/server/entitlements';

const message = (e: unknown) => encodeURIComponent(e instanceof BillingError ? e.message : 'Something went wrong. Please try again.');

export async function checkoutAction(form: FormData) {
  const interval = form.get('interval') === 'year' ? 'year' : 'month';
  const session = await getSession();
  if (!session) redirect(`/signup?next=${encodeURIComponent('/pricing')}`);
  if ((await currentPlan(session.user.id)).plan === 'LIVE') redirect('/account');
  let url: string;
  try {
    url = await startCheckout(session.user.id, interval);
  } catch (e) {
    if (!(e instanceof BillingError)) console.error(e);
    redirect(`/pricing?error=${message(e)}`);
  }
  redirect(url);
}

export async function sandboxPayAction(form: FormData) {
  const session = await getSession();
  if (!session) redirect('/login');
  try {
    await completeSandboxPayment(session.user.id, String(form.get('subscription') ?? ''));
  } catch (e) {
    redirect(`/pricing?error=${message(e)}`);
  }
  redirect('/account?paid=1');
}

export async function cancelAction() {
  const session = await getSession();
  if (!session) redirect('/login');
  try {
    await cancelSubscription(session.user.id);
  } catch (e) {
    if (!(e instanceof BillingError)) console.error(e);
    redirect(`/account?error=${message(e)}`);
  }
  redirect('/account?cancelled=1');
}
