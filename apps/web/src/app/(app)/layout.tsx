import { AppShell } from '@/components/app/app-shell';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/server/admin';
import { currentPlan } from '@/server/entitlements';

export const dynamic = 'force-dynamic';

/** Every feature page shares the sidebar shell. Open to everyone: visitors get a few free runs a day. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const user = session
    ? { name: session.user.name, email: session.user.email, plan: (await currentPlan(session.user.id)).plan, admin: isAdmin(session.user.email) }
    : null;
  return <AppShell user={user}>{children}</AppShell>;
}
