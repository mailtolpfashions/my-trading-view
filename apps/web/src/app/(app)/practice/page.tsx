import type { Metadata } from 'next';
import { History } from 'lucide-react';

export const metadata: Metadata = { title: 'Practice mode' };

/** Practice mode (bar replay on data at least 30 days old) is a later build step. */
export default function PracticePage() {
  return (
    <section className="panel grid place-items-center">
      <div className="m-auto max-w-[320px] px-4 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-[12px] bg-deep text-accent"><History size={20} aria-hidden="true" /></span>
        <h1 className="mt-3 text-[15px] font-extrabold tracking-[-0.02em]">Practice mode is coming</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          Replay any stock or index bar by bar from a date at least 30 days back, and practise entries and exits with real charges. No live prices, no prizes.
        </p>
      </div>
    </section>
  );
}
