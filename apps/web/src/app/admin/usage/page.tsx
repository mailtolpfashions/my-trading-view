import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@mtv/db';
import { SiteShell } from '@/components/site-shell';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/server/admin';

export const metadata: Metadata = { title: 'Live usage', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Users who received real-time data, per IST month: the count to report to the data vendor / NSE for per-user fees.
 * Restricted to the emails in ADMIN_EMAILS.
 */
export default async function LiveUsageReport() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/usage');
  if (!isAdmin(session.user.email)) notFound();

  const rows = await prisma.liveUsage.findMany({ orderBy: [{ month: 'desc' }, { firstSeen: 'asc' }], include: { user: { select: { email: true, name: true } } } });
  const months = [...new Set(rows.map((r) => r.month))];

  return (
    <SiteShell>
      <div className="mx-auto max-w-[900px] space-y-4 pt-6 pb-10">
        <h1 className="text-[34px] font-extrabold tracking-[-0.035em]">Live data users</h1>
        <p className="text-[14px] text-ink-2">Each user is counted once in a month in which they received any real-time price. Months are in IST.</p>
        {months.length === 0 && <p className="panel p-6 text-[14px] text-muted">No real-time usage recorded yet.</p>}
        {months.map((m) => {
          const list = rows.filter((r) => r.month === m);
          return (
            <section key={m} className="panel p-6">
              <h2 className="flex items-baseline justify-between"><span className="num text-[18px] font-extrabold">{m}</span><span className="num text-[14px] font-bold">{list.length} user{list.length === 1 ? '' : 's'}</span></h2>
              <table className="mt-3 w-full text-[13.5px]">
                <tbody>
                  {list.map((r) => (
                    <tr key={r.userId} className="border-t border-line">
                      <td className="py-1.5">{r.user.name}</td>
                      <td className="text-ink-2">{r.user.email}</td>
                      <td className="num text-right text-muted">{r.firstSeen.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </SiteShell>
  );
}
