import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { Banner, SiteShell } from '@/components/site-shell';
import { getSession } from '@/lib/auth';
import { PLANS, priceLabel, type BillingInterval } from '@/lib/plans';
import { checkoutAction } from '@/server/billing-actions';
import { currentPlan } from '@/server/entitlements';

export const metadata: Metadata = { title: 'Pricing' };
export const dynamic = 'force-dynamic';

export default async function Pricing({ searchParams }: { searchParams: Promise<{ interval?: string; error?: string }> }) {
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
        <p className="mx-auto mt-3 max-w-[560px] text-[16px] text-ink-2">Start free with delayed prices. Upgrade when you want real-time NSE data. Cancel any time.</p>
        <div className="mt-6 inline-flex rounded-full bg-panel p-1 shadow-[var(--shadow-panel)]" role="group" aria-label="Billing period">
          {(['month', 'year'] as const).map((i) => (
            <Link key={i} href={`/pricing?interval=${i}`} aria-current={i === interval ? 'true' : undefined} className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${i === interval ? 'bg-ink text-white' : 'text-ink-2 hover:bg-raised'}`}>
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
            <Link href="/terminal" className="mt-auto rounded-full bg-raised py-3 text-center font-bold">Open terminal</Link>
          ) : (
            <Link href="/signup" className="mt-auto rounded-full bg-raised py-3 text-center font-bold hover:bg-line">Start free</Link>
          )}
        </article>

        <article className="panel flex flex-col p-7 ring-2 ring-accent">
          <h2 className="flex items-center gap-2 text-[20px] font-extrabold">{PLANS.LIVE.name} <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">Real-time</span></h2>
          <p className="text-[13.5px] text-ink-2">{PLANS.LIVE.tagline}</p>
          <p className="mt-5">
            <span className="num text-[40px] font-extrabold tracking-[-0.03em]">{priceLabel(live)}</span>
            <span className="text-[14px] text-muted"> / {interval} incl. GST</span>
          </p>
          <Features list={PLANS.LIVE.features} />
          {plan === 'LIVE' ? (
            <Link href="/account" className="mt-auto rounded-full bg-ink py-3 text-center font-bold text-white">You&rsquo;re on Live · Manage</Link>
          ) : (
            <form action={checkoutAction} className="mt-auto">
              <input type="hidden" name="interval" value={interval} />
              <button type="submit" className="w-full rounded-full bg-ink py-3 font-bold text-white hover:bg-black">{session ? 'Upgrade to Live' : 'Sign up and upgrade'}</button>
            </form>
          )}
        </article>
      </div>

      <p className="mx-auto mt-6 max-w-[640px] text-center text-[12.5px] text-muted">
        Payments by UPI Autopay, cards or net banking, renewing automatically until you cancel. Real-time data is supplied under an NSE-authorised
        data vendor licence for your personal use only. My Trading View is not investment advice; see the <Link href="/disclaimer" className="underline">disclaimer</Link>.
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
