'use client';

import { useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { DataQuality } from '@mtv/shared';

const ist = (t: number) => {
  const d = new Date((t + 5.5 * 3600) * 1000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`;
};

/**
 * Shows the feed's audit of the loaded candles. Problems are never hidden: missing or frozen bars change
 * indicator values, so the user is told exactly which bars are affected.
 */
export function DataCheck({ quality, delayed }: { quality: DataQuality | null; delayed: boolean }) {
  const [open, setOpen] = useState(false);
  if (!quality) return null;
  const issues = [
    quality.missing.length && `${quality.missing.length} missing`,
    quality.suspect.length && `${quality.suspect.length} frozen`,
    quality.invalid.length && `${quality.invalid.length} invalid (removed)`,
    quality.misaligned.length && `${quality.misaligned.length} off-grid (removed)`,
  ].filter(Boolean) as string[];

  const off = quality.official;
  const day = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const officialNote = off && (
    <p className="mt-2">
      {off.verified
        ? <>Checked against <b className="font-bold text-ink">NSE&rsquo;s official end-of-day files</b> for {off.verified} day{off.verified > 1 ? 's' : ''} (latest {day(off.latest!)}).
            {off.corrected.length ? ` ${off.corrected.length} bar${off.corrected.length > 1 ? 's were' : ' was'} corrected or added from NSE's official record:${off.corrected.slice(0, 8).map((c) => `${ist(c.time).slice(0, 5)} (${c.fields.join(', ')})`).join('; ')}.` : ' All matched exactly.'}</>
        : <>Not yet checked against NSE&rsquo;s official end-of-day files; they download automatically each evening.</>}
    </p>
  );

  if (quality.ok) {
    const verified = !!off?.verified;
    return (
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-full bg-up-soft px-2.5 py-1 text-[11.5px] font-semibold text-up"
        >
          <ShieldCheck size={13} aria-hidden="true" /> {verified ? `Verified with NSE · ${off!.verified} days` : 'Data check passed'}
        </button>
        {open && (
          <div className="absolute top-8 right-0 z-30 w-[360px] rounded-[14px] whitespace-normal bg-panel p-4 text-[12.5px] leading-relaxed text-ink-2 shadow-[var(--shadow-pop)]">
            <p className="font-bold text-ink">Every bar passed the session-grid check</p>
            <p className="mt-1">No missing, frozen, invalid or off-grid bars in the loaded history.</p>
            {officialNote}
          </div>
        )}
      </div>
    );
  }

  const list = (label: string, times: number[]) =>
    times.length ? (
      <p className="mt-2">
        <b className="font-bold text-ink">{label}:</b>{' '}
        <span className="num text-[11.5px]">{times.slice(0, 12).map(ist).join(', ')}{times.length > 12 ? ` and ${times.length - 12} more` : ''}</span>
      </p>
    ) : null;

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-bold text-accent-ink ring-1 ring-accent hover:bg-accent"
      >
        <ShieldAlert size={13} aria-hidden="true" /> Data check: {issues.join(' · ')} bars
      </button>
      {open && (
        <div className="absolute top-8 right-0 z-30 w-[380px] rounded-[14px] whitespace-normal bg-panel p-4 text-[12.5px] leading-relaxed text-ink-2 shadow-[var(--shadow-pop)]">
          <p className="font-bold text-ink">This chart&rsquo;s data is not complete</p>
          <p className="mt-1">
            Indicator values near these bars can differ from TradingView and the exchange. We never fill gaps with made-up prices.
            {delayed && ' The free data source has these defects; a licensed broker feed (Kite) provides exact NSE data.'}
          </p>
          {list('Missing', quality.missing)}
          {list('Frozen (price did not move)', quality.suspect)}
          {list('Invalid, removed', quality.invalid)}
          {list('Off-grid or duplicate, removed', quality.misaligned)}
          {officialNote}
        </div>
      )}
    </div>
  );
}
