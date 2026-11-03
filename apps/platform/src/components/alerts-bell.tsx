'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, X } from 'lucide-react';
import { alertsApi, type AlertEvent } from '@/lib/alerts';

/** A short two-tone chime (Web Audio, no file to load). Browsers allow it once the page has been clicked. */
function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.3);
    });
  } catch { /* no audio available */ }
}

/** Top-bar bell: unread count, and a pop-up with a chime when a new alert arrives (checked every 15 seconds). */
export function AlertsBell() {
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<AlertEvent | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => alertsApi.events().then((ev) => {
      if (!alive) return;
      setUnread(ev.filter((e) => !e.read).length);
      const fresh = seen.current ? ev.filter((e) => !seen.current!.has(e.id) && !e.read && e.hits.length) : [];
      seen.current = new Set(ev.map((e) => e.id));
      if (fresh.length) { setToast(fresh[0]); chime(); }
    }, () => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <>
      <Link href="/alerts" aria-label={`Alerts${unread ? `, ${unread} unread` : ''}`} title="Alerts"
        className="relative grid h-11 w-11 place-items-center rounded-[12px] border border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink">
        <Bell size={18} />
        {unread > 0 && <span className="num absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-down px-1 text-[11px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
      </Link>
      {toast && (
        <div role="status" className="fixed bottom-5 right-5 z-50 w-[340px] rounded-[16px] bg-panel p-4 shadow-[var(--shadow-pop)]">
          <div className="flex items-start gap-2">
            <Bell size={16} className="mt-0.5 shrink-0 text-accent-deep" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">{toast.alertName}</p>
              <p className="text-[13px] text-ink-2">{toast.hits.slice(0, 6).map((h) => h.symbol).join(', ')}{toast.hits.length > 6 ? ` and ${toast.hits.length - 6} more` : ''}</p>
              <Link href="/alerts" onClick={() => setToast(null)} className="mt-1 inline-block text-[13px] font-semibold text-accent-deep hover:underline">See alerts</Link>
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-[8px] text-muted hover:bg-raised"><X size={15} /></button>
          </div>
        </div>
      )}
    </>
  );
}
