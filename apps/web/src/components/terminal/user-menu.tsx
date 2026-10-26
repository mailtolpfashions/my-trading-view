'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LogOut, Sparkles, UserRound } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { PLANS, type PlanId } from '@/lib/plans';

export type TerminalUser = { name: string; email: string; plan: PlanId; admin: boolean };

export function UserMenu({ user }: { user: TerminalUser }) {
  const [open, setOpen] = useState(false);
  const signOut = async () => {
    await authClient.signOut();
    window.location.href = '/login';
  };
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${user.name}, ${PLANS[user.plan].name} plan`}
        title={user.name}
        className="flex h-8 items-center gap-1.5 rounded-full bg-panel pr-1 pl-2.5 text-[12px] font-semibold whitespace-nowrap shadow-[var(--shadow-panel)]"
      >
        <UserRound size={15} aria-hidden="true" />
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${user.plan === 'LIVE' ? 'bg-up-soft text-up' : 'bg-raised text-ink-2'}`}>{PLANS[user.plan].name}</span>
      </button>
      {open && (
        <div role="menu" className="absolute top-10 right-0 z-50 w-64 rounded-2xl bg-panel p-2 shadow-[var(--shadow-pop)]">
          <div className="px-3 py-2">
            <div className="truncate text-[13px] font-bold">{user.name}</div>
            <div className="truncate text-[12px] text-muted">{user.email}</div>
          </div>
          {user.plan === 'FREE' && (
            <Link href="/pricing" role="menuitem" className="flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-[12.5px] font-bold text-accent-ink">
              <Sparkles size={14} aria-hidden="true" /> Upgrade to Live for real-time prices
            </Link>
          )}
          <Link href="/account" role="menuitem" className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold text-ink-2 hover:bg-raised">
            <UserRound size={14} aria-hidden="true" /> Account &amp; billing
          </Link>
          <button type="button" role="menuitem" onClick={signOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] font-semibold text-ink-2 hover:bg-raised">
            <LogOut size={14} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
