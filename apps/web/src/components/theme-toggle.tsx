'use client';

import { Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from '@/lib/theme';

/** Light / dark switch; the choice is remembered in this browser. */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`${next === 'dark' ? 'Dark' : 'Light'} theme`}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel text-ink-2 shadow-[var(--shadow-panel)] hover:text-ink">
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
