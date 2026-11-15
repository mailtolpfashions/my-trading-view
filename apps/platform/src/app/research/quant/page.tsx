import type { Metadata } from 'next';
import { QuantReport } from '@/components/research/quant-report';

export const metadata: Metadata = { title: 'Quant research report', description: 'Every experiment of the research programme: settings, trades and curves, with filters.' };

export default function QuantReportPage() {
  return <QuantReport />;
}
