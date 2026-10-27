'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import type { AlertEventMessage } from '@mtv/shared';
import { fetchAlerts, markAlertsSeen, type AlertEventRow } from '@/lib/alerts';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** Header bell: unread count and the latest alerts that fired. `latest` is the alert just pushed by the server. */
export function AlertBell({ latest, onManage }: { latest: AlertEventMessage | null; onManage: () => void }) {
  const [events, setEvents] = useState<AlertEventRow[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { fetchAlerts().then((r) => setEvents(r.events), () => {}); }, [latest]);
  const unread = events.filter((e) => !e.seen).length;

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && unread) markAlertsSeen().then(() => setEvents((list) => list.map((e) => ({ ...e, seen: true }))), () => {});
  };

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={toggle} aria-expanded={open} aria-label={unread ? `Alerts, ${unread} new` : 'Alerts'}
        className="relative grid h-8 w-8 place-items-center rounded-full bg-panel shadow-[var(--shadow-panel)] hover:bg-raised">
        <Bell size={15} />
        {unread > 0 && <span className="num absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-down px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute top-10 right-0 z-50 w-80 rounded-2xl bg-panel p-2 shadow-[var(--shadow-pop)]">
          <p className="px-2 pt-1 pb-1.5 text-[12px] font-bold text-ink-2">Recent alerts</p>
          {!events.length && <p className="px-2 pb-2 text-[12.5px] text-muted">No alerts have fired yet.</p>}
          <div className="max-h-72 overflow-y-auto">
            {events.slice(0, 8).map((e) => (
              <div key={e.id} className="rounded-xl px-2 py-1.5 hover:bg-raised">
                <p className="text-[12.5px] leading-snug">{e.message}</p>
                <p className="text-[11px] text-muted">{when(e.triggeredAt)}</p>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); onManage(); }} className="mt-1 w-full rounded-xl bg-raised px-3 py-2 text-[12.5px] font-bold hover:bg-line">Manage alerts</button>
        </div>
      )}
    </div>
  );
}
