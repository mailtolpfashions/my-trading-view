'use client';

// Light / dark theme. The choice is kept in this browser (localStorage) and applied before first paint by the inline
// script in app/layout.tsx (lib/theme-boot.ts), so pages never flash the wrong theme. Light is the default.

import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
import { THEME_KEY } from './theme-boot';

const read = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

export function setTheme(t: Theme) {
  if (t === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage unavailable: applies to this page only */ }
}

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

/** The current theme; re-renders when it changes. */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, read, () => 'light');

/**
 * Canvas chart colours (lightweight-charts and the drawing layer can't read CSS variables, and accept only hex and
 * comma rgba()). Values mirror the tokens in globals.css.
 */
export const CHART_COLORS = {
  light: { bg: '#ffffff', text: '#514a40', grid: '#f4efe6', line: '#efe9df', cross: '#9a917f', crossLabel: '#1f1a14', hover: 'rgba(31,26,20,0.08)', watermark: 'rgba(31,26,20,0.06)', zero: '#8f877b', ink: '#1f1a14', ink2: '#514a40', level: '#c9bfae' },
  dark: { bg: '#1c1914', text: '#cfc6b6', grid: '#26221b', line: '#2e2921', cross: '#7d7465', crossLabel: '#3d362b', hover: 'rgba(246,240,230,0.08)', watermark: 'rgba(246,240,230,0.05)', zero: '#958c7d', ink: '#f6f0e6', ink2: '#cfc6b6', level: '#574f42' },
} as const;
export type ChartColors = (typeof CHART_COLORS)[Theme];

/** Theme part of a lightweight-charts options object (pass to createChart or applyOptions). */
export const chartThemeOptions = (c: ChartColors) => ({
  layout: { background: { color: c.bg }, textColor: c.text, panes: { separatorColor: c.line, separatorHoverColor: c.hover } },
  grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
  crosshair: { vertLine: { color: c.cross, labelBackgroundColor: c.crossLabel }, horzLine: { color: c.cross, labelBackgroundColor: c.crossLabel } },
  rightPriceScale: { borderColor: c.line },
  timeScale: { borderColor: c.line },
});
