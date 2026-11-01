import { redirect } from 'next/navigation';

/** The single-page terminal was split into one page per feature (2026-11-01). */
export default function TerminalPage() {
  redirect('/dashboard');
}
