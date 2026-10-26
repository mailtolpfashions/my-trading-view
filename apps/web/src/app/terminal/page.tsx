import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Terminal } from '@/components/terminal/terminal';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/server/admin';
import { currentPlan } from '@/server/entitlements';

export const metadata: Metadata = { title: 'Terminal', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function TerminalPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/terminal');
  const { plan } = await currentPlan(session.user.id);
  return <Terminal user={{ name: session.user.name, email: session.user.email, plan, admin: isAdmin(session.user.email) }} />;
}
