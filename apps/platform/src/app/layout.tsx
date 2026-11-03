import type { Metadata, Viewport } from 'next';
import { Outfit } from 'next/font/google';
import { THEME_BOOT } from '@/lib/theme-boot';
import { AppShell } from '@/components/app-shell';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-outfit', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Nandibull', template: '%s | Nandibull' },
  description: 'Stock screener and strategy builder for NSE.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#FAF6EF' }, { media: '(prefers-color-scheme: dark)', color: '#12100C' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={outfit.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh font-sans text-[15px]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
