'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { liveApi, type LiveStatus } from '@/lib/live';

/** Top-bar chip: live / connecting / connect Kite. Refreshes every 15 seconds. */
export function LiveChip() {
  const [s, setS] = useState<LiveStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => liveApi.status().then((x) => alive && setS(x), () => alive && setS(null));
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const live = s?.state === 'live';
  const label = !s ? 'Data service offline' : live ? 'Live' : s.state === 'starting' ? 'Connecting…' : s.state === 'error' ? 'Live data error' : 'Connect Kite';
  return (
    <Link href="/connect" title={live && s?.userName ? `Kite: ${s.userName}` : 'Live data from your Kite account'}
      className={`flex h-9 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold ${live ? 'border-up/30 bg-up-soft text-up' : 'border-line-strong bg-panel text-ink-2 hover:text-ink'}`}>
      <span className={`h-2 w-2 rounded-full ${live ? 'live-dot bg-up' : s?.state === 'error' ? 'bg-down' : 'bg-muted'}`} />
      {label}
    </Link>
  );
}
