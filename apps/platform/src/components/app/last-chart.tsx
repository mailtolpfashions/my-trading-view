'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { readPersisted } from '@/lib/persisted';
import { chartHref } from './shell-context';

/** /chart without a symbol: open the last chart viewed in this browser, else NIFTY. */
export function LastChart() {
  const router = useRouter();
  useEffect(() => { router.replace(chartHref(readPersisted('mtv.lastSymbol', 'NIFTY'))); }, [router]);
  return <section className="panel grid place-items-center text-[13px] text-muted">Opening chart…</section>;
}
