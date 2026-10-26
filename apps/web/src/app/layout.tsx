import type { Metadata, Viewport } from 'next';
import { Manrope, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope', display: 'swap' });
// Numbers use Plus Jakarta Sans with tabular figures, as in the Kicko CRM.
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: { default: 'My Trading View · Trading workspace for the Indian market', template: '%s · My Trading View' },
  description:
    'Charts, option chains, futures analytics, rule-based signals, backtesting and paper trading for NSE and BSE in one workspace.',
  openGraph: { type: 'website', siteName: 'My Trading View', locale: 'en_IN' },
};

export const viewport: Viewport = { themeColor: '#E8E7E2' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${manrope.variable} ${jakarta.variable}`}>
      <body className="min-h-dvh font-sans text-[15px]">{children}</body>
    </html>
  );
}
