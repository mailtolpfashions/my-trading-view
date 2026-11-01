import type { Metadata, Viewport } from 'next';
import { Manrope, Plus_Jakarta_Sans } from 'next/font/google';
import { THEME_BOOT } from '@/lib/theme-boot';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope', display: 'swap' });
// Numbers use Plus Jakarta Sans with tabular figures, as in the Kicko CRM.
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'My Trading View · Trading workspace for the Indian market', template: '%s · My Trading View' },
  description:
    'Research, backtesting and option strategy building on NSE end-of-day data: charts, option chain, futures, SPAN margin and NIFTY research.',
  openGraph: { type: 'website', siteName: 'My Trading View', locale: 'en_IN' },
};

export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#E8E7E2' }, { media: '(prefers-color-scheme: dark)', color: '#0F0F0D' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme is set on <html> by THEME_BOOT before first paint (from this browser's saved choice), so React must not
    // treat that attribute as a mismatch.
    <html lang="en-IN" className={`${manrope.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh font-sans text-[15px]">{children}</body>
    </html>
  );
}
