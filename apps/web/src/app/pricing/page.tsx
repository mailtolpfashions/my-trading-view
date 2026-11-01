import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check } from 'lucide-react';
import { Banner, SiteShell } from '@/components/site-shell';
import { getSession } from '@/lib/auth';
import { PLANS, priceLabel, type BillingInterval } from '@/lib/plans';
import { PAID_PLANS } from '@/lib/site-mode';
import { checkoutAction } from '@/server/billing-actions';
import { currentPlan } from '@/server/entitlements';

export const metadata: Metadata = { title: 'Pricing' };
export const dynamic = 'force-dynamic';

export default async function Pricing({ searchParams }: { searchParams: Promise<{ interval?: string; error?: string }> }) {
  if (!PAID_PLANS) notFound(); // the site is free for now
  const sp = await searchParams;
  const interval: BillingInterval = sp.interval === 'year' ? 'year' : 'month';
  const session = await getSession();
  const plan = session ? (await currentPlan(session.user.id)).plan : null;
  const live = PLANS.LIVE.pricePaise[interval];
  const monthsFree = 12 - PLANS.LIVE.pricePaise.year / PLANS.LIVE.pricePaise.month;

  return (
    <SiteShell>
      <section className="pt-8 pb-6 text-center">
        <h1 className="text-[clamp(32px,5vw,52px)] leading-[1.05] font-extrabold tracking-[-0.04em]">Simple pricing</h1>
        <p className="mx-auto mt-3 max-w-[560px] text-[16px] text-ink-2">Research, backtesting and strategy building on NSE end-of-day data. Start free; cancel any time.</p>
        <div className="mt-6 inline-flex rounded-full bg-panel p-1 shadow-[var(--shadow-panel)]" role="group" aria-label="Billing period">
          {(['month', 'year'] as const).map((i) => (
            <Link key={i} href={`/pricing?interval=${i}`} aria-current={i === interval ? 'true' : undefined} className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${i === interval ? 'bg-inverse text-on-inverse' : 'text-ink-2 hover:bg-raised'}`}>
              {i === 'month' ? 'Monthly' : `Yearly${monthsFree >= 1 ? ` · ${Math.floor(monthsFree)} months free` : ''}`}
            </Link>
          ))}
        </div>
      </section>

      {sp.error && <div className="mx-auto mb-4 max-w-[860px]"><Banner tone="bad">{sp.error}</Banner></div>}

      <div className="mx-auto grid max-w-[860px] gap-4 md:grid-cols-2">
        <article className="panel flex flex-col p-7">
          <h2 className="text-[20px] font-extrabold">{PLANS.FREE.name}</h2>
          <p className="text-[13.5px] text-ink-2">{PLANS.FREE.tagline}</p>
          <p className="num mt-5 text-[40px] font-extrabold tracking-[-0.03em]">{priceLabel(0)}</p>
          <Features list={PLANS.FREE.features} />
          {plan ? (
            <Link href="/dashboard" className="mt-auto rounded-full bg-raised py-3 text-center font-bold">Open dashboard</Link>
          ) : (
            <Link href="/signup" className="mt-auto rounded-full bg-raised py-3 text-center font-bold hover:bg-line">Start free</Link>
          )}
        </article>

        <article className="panel flex flex-col p-7 ring-2 ring-accent">
          <h2 className="flex items-center gap-2 text-[20px] font-extrabold">{PLANS.LIVE.name}</h2>
          <p className="text-[13.5px] text-ink-2">{PLANS.LIVE.tagline}</p>
          <p className="mt-5">
            <span className="num text-[40px] font-extrabold tracking-[-0.03em]">{priceLabel(live)}</span>
            <span className="text-[14px] text-muted"> / {interval} incl. GST</span>
          </p>
          <Features list={PLANS.LIVE.features} />
          {plan === 'LIVE' ? (
            <Link href="/account" className="mt-auto rounded-full bg-inverse py-3 text-center font-bold text-on-inverse">You&rsquo;re on Pro · Manage</Link>
          ) : (
            <form action={checkoutAction} className="mt-auto">
              <input type="hidden" name="interval" value={interval} />
              <button type="submit" className="w-full rounded-full bg-inverse py-3 font-bold text-on-inverse hover:bg-inverse-hover">{session ? 'Upgrade to Pro' : 'Sign up and upgrade'}</button>
            </form>
          )}
        </article>
      </div>

      <p className="mx-auto mt-6 max-w-[640px] text-center text-[12.5px] text-muted">
        Payments by UPI Autopay, cards or net banking, renewing automatically until you cancel. All prices shown are NSE&rsquo;s official
        end-of-day data; the site has no live prices. Nandibull is not investment advice; see the <Link href="/disclaimer" className="underline">disclaimer</Link>.
      </p>
    </SiteShell>
  );
}

function Features({ list }: { list: string[] }) {
  return (
    <ul className="my-6 space-y-2.5 text-[14px]">
      {list.map((f) => (
        <li key={f} className="flex gap-2.5"><Check size={17} className="mt-0.5 shrink-0 text-up" aria-hidden="true" />{f}</li>
      ))}
    </ul>
  );
}
