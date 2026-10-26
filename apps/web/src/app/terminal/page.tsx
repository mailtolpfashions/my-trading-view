import type { Metadata } from 'next';
import { Terminal } from '@/components/terminal/terminal';

export const metadata: Metadata = { title: 'Terminal', robots: { index: false } };

export default function TerminalPage() {
  return <Terminal />;
}
