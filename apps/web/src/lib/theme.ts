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
  light: { bg: '#ffffff', text: '#131722', grid: '#f3f2ee', line: '#ecebe6', cross: '#9598a1', crossLabel: '#121212', hover: 'rgba(18,18,18,0.08)', watermark: 'rgba(18,18,18,0.06)', zero: '#8b8a83', ink: '#121212', ink2: '#45453f', level: '#b2b5be' },
  dark: { bg: '#1a1a17', text: '#c3c2b9', grid: '#23231f', line: '#2c2c27', cross: '#6f7280', crossLabel: '#2e2d28', hover: 'rgba(241,240,234,0.08)', watermark: 'rgba(241,240,234,0.05)', zero: '#8f8e85', ink: '#f1f0ea', ink2: '#c3c2b9', level: '#55574f' },
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
