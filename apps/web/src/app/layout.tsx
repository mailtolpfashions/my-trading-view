import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import { THEME_BOOT } from '@/lib/theme-boot';
import './globals.css';

// One family for text and numbers: Outfit has tabular figures, which the `num` utility turns on.
const outfit = Outfit({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-outfit', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Nandibull · Trading workspace for the Indian market', template: '%s · Nandibull' },
  description:
    'Research, backtesting and option strategy building on NSE end-of-day data: charts, option chain, futures, SPAN margin and NIFTY research.',
  openGraph: { type: 'website', siteName: 'Nandibull', locale: 'en_IN' },
};

export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#FAF6EF' }, { media: '(prefers-color-scheme: dark)', color: '#12100C' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme is set on <html> by THEME_BOOT before first paint (from this browser's saved choice), so React must not
    // treat that attribute as a mismatch.
    <html lang="en-IN" className={outfit.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh font-sans text-[15px]">{children}</body>
    </html>
  );
}
