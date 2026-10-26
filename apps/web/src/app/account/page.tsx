import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@mtv/db';
import { Banner, SiteShell } from '@/components/site-shell';
import { getSession } from '@/lib/auth';
import { PLANS, priceLabel } from '@/lib/plans';
import { cancelAction } from '@/server/billing-actions';
import { currentPlan } from '@/server/entitlements';

export const metadata: Metadata = { title: 'Account', robots: { index: false } };
export const dynamic = 'force-dynamic';

const date = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

export default async function Account({ searchParams }: { searchParams: Promise<{ paid?: string; cancelled?: string; error?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/account');
  const sp = await searchParams;
  const { plan, until } = await currentPlan(session.user.id);
  const [sub, payments] = await Promise.all([
    prisma.subscription.findFirst({ where: { userId: session.user.id, status: { in: ['ACTIVE', 'HALTED', 'CANCELLED'] } }, orderBy: { updatedAt: 'desc' } }),
    prisma.payment.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: 'desc' }, take: 24 }),
  ]);
  const renews = sub?.status === 'ACTIVE' && !sub.cancelAtPeriodEnd;

  return (
    <SiteShell>
      <div className="mx-auto max-w-[780px] space-y-4 pt-6 pb-10">
        <h1 className="text-[34px] font-extrabold tracking-[-0.035em]">Account</h1>
        {sp.paid && <Banner tone="good">Payment received. Live data is on: reopen the terminal to switch to real-time prices.</Banner>}
        {sp.cancelled && <Banner tone="good">Renewal cancelled. You keep Live until the end of the paid period.</Banner>}
        {sp.error && <Banner tone="bad">{sp.error}</Banner>}

        <section className="panel p-6">
          <h2 className="eyebrow">Profile</h2>
          <p className="mt-2 text-[16px] font-bold">{session.user.name}</p>
          <p className="text-[14px] text-ink-2">{session.user.email}</p>
        </section>

        <section className="panel p-6">
          <h2 className="eyebrow">Plan</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-[22px] font-extrabold">{PLANS[plan].name}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${plan === 'LIVE' ? 'bg-up-soft text-up' : 'bg-raised text-ink-2'}`}>{plan === 'LIVE' ? 'Real-time data' : '15-minute delayed data'}</span>
          </div>
          {plan === 'LIVE' && until && (
            <p className="mt-2 text-[14px] text-ink-2">
              {renews ? <>Renews on <b className="num">{date(until)}</b> ({sub!.interval === 'year' ? 'yearly' : 'monthly'}).</> : <>Live until <b className="num">{date(until)}</b>. Renewal is off.</>}
            </p>
          )}
          {sub?.status === 'HALTED' && <p className="mt-2 text-[14px] font-semibold text-down">Your last renewal payment failed. Update your payment method with your bank or UPI app, or subscribe again.</p>}
          <div className="mt-5 flex flex-wrap gap-3">
            {plan === 'FREE' && <Link href="/pricing" className="rounded-full bg-ink px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-black">Upgrade to Live</Link>}
            {(renews || sub?.status === 'HALTED') && (
              <form action={cancelAction}>
                <button type="submit" className="rounded-full bg-raised px-5 py-2.5 text-[13.5px] font-bold hover:bg-line">Cancel renewal</button>
              </form>
            )}
            <Link href="/terminal" className="rounded-full bg-raised px-5 py-2.5 text-[13.5px] font-bold hover:bg-line">Open terminal</Link>
          </div>
        </section>

        <section className="panel p-6">
          <h2 className="eyebrow">Payments</h2>
          {payments.length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">No payments yet.</p>
          ) : (
            <table className="mt-3 w-full text-[14px]">
              <thead>
                <tr className="text-left text-[12px] text-muted"><th className="py-1.5 font-semibold">Date</th><th className="font-semibold">Reference</th><th className="text-right font-semibold">Amount</th></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="num py-2">{date(p.createdAt)}</td>
                    <td className="num text-[12.5px] text-ink-2">{p.paymentId}{p.provider === 'billing-sandbox' && ' (test)'}</td>
                    <td className="num text-right font-semibold">{p.currency === 'INR' ? priceLabel(p.amountPaise) : `${(p.amountPaise / 100).toFixed(2)} ${p.currency}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </SiteShell>
  );
}
