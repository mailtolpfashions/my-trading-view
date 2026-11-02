import type { Metadata } from 'next';
import Link from 'next/link';
import { History } from 'lucide-react';

export const metadata: Metadata = { title: 'Practice' };

const START = ['NIFTY', 'BANKNIFTY', 'RELIANCE', 'HDFCBANK', 'INFY', 'TCS'];

/** Practice is bar replay on the chart page: this page explains it and starts one. */
export default function PracticePage() {
  return (
    <section className="panel grid place-items-center p-6">
      <div className="m-auto max-w-[460px] text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-accent-soft text-accent-deep"><History size={22} aria-hidden="true" /></span>
        <h1 className="mt-3 text-[22px] font-bold tracking-[-0.02em]">Practice with bar replay</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Pick a start date and the chart hides everything after it. Play the bars forward one at a time, buy and sell at each close, and see how your
          trades would have gone. Practice uses data at least 30 days old and has no prizes.
        </p>
        <p className="mt-5 text-[12.5px] font-semibold text-muted">Start on</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {START.map((s) => (
            <Link key={s} href={`/chart/${s}?replay=1`} className="rounded-full bg-raised px-4 py-2 text-[13.5px] font-semibold hover:bg-accent-soft hover:text-accent-deep">{s}</Link>
          ))}
        </div>
        <p className="mt-4 text-[12.5px] text-muted">Or open any chart and press <b className="text-ink-2">Replay</b> in its toolbar.</p>
      </div>
    </section>
  );
}
