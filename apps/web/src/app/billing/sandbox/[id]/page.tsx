import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@mtv/db';
import { SiteShell } from '@/components/site-shell';
import { getSession } from '@/lib/auth';
import { PLANS, priceLabel, type BillingInterval } from '@/lib/plans';
import { billingProvider } from '@/server/billing';
import { sandboxPayAction } from '@/server/billing-actions';

export const metadata: Metadata = { title: 'Test checkout', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Stands in for the payment gateway while BILLING_PROVIDER=sandbox. No money moves. */
export default async function SandboxCheckout({ params }: { params: Promise<{ id: string }> }) {
  if (billingProvider() !== 'sandbox') notFound();
  const session = await getSession();
  const { id } = await params;
  if (!session) redirect(`/login?next=${encodeURIComponent(`/billing/sandbox/${id}`)}`);
  const sub = await prisma.subscription.findFirst({ where: { id, userId: session.user.id, provider: 'billing-sandbox', status: 'PENDING' } });
  if (!sub) notFound();
  const interval = sub.interval as BillingInterval;

  return (
    <SiteShell>
      <div className="panel mx-auto mt-8 max-w-[440px] space-y-5 p-7">
        <p className="rounded-[12px] bg-accent-soft px-3 py-2 text-[12.5px] font-bold text-accent-ink">Test mode: no money is charged.</p>
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">Confirm subscription</h1>
          <p className="mt-1 text-[14px] text-ink-2">{PLANS.LIVE.name} plan, billed {interval === 'year' ? 'yearly' : 'monthly'}</p>
        </div>
        <p className="num text-[34px] font-extrabold">{priceLabel(PLANS.LIVE.pricePaise[interval])}</p>
        <form action={sandboxPayAction}>
          <input type="hidden" name="subscription" value={sub.id} />
          <button type="submit" className="h-11 w-full rounded-full bg-ink font-bold text-white hover:bg-black">Pay (test)</button>
        </form>
        <Link href="/pricing" className="block text-center text-[13px] font-semibold text-ink-2 underline">Cancel and go back</Link>
      </div>
    </SiteShell>
  );
}
