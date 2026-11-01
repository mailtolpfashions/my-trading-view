'use client';

import { Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from '@/lib/theme';

/** Light / dark switch; the choice is remembered in this browser. */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`${next === 'dark' ? 'Dark' : 'Light'} theme`}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink">
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
