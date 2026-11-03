'use client';

import type { Tf } from '@mtv/rules';
import { INTRADAY_OPTIONS, TF_LABEL } from '@/lib/screener';
import { inputCls } from './ui';

/** Timeframes grouped as intraday (from live Kite data) and end of day. */
export function TimeframeOptions() {
  return (
    <>
      <optgroup label="End of day">{(['D', 'W', 'M'] as const).map((t) => <option key={t} value={t}>{TF_LABEL[t]}</option>)}</optgroup>
      <optgroup label="Intraday (live data)">{INTRADAY_OPTIONS.map((t) => <option key={t} value={t}>{TF_LABEL[t]}</option>)}</optgroup>
    </>
  );
}

export function TimeframeSelect({ value, onChange, label = 'Timeframe' }: { value: Tf; onChange: (t: Tf) => void; label?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Tf)} aria-label={label} className={`${inputCls} min-w-[140px] pr-8`}>
      <TimeframeOptions />
    </select>
  );
}
