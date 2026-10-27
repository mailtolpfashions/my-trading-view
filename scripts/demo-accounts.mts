// Creates demo accounts for testing: one Free, one Live (a 1-year sandbox subscription, no payment).
// Accounts are created through the site's own sign-up endpoint, so passwords are hashed exactly as for real users.
// Run with the web app running:  npx dotenv -e .env -- npx tsx scripts/demo-accounts.mts [--recreate]
// --recreate deletes and recreates the demo accounts (and their paper trades) with new passwords.

import { randomBytes } from 'node:crypto';
import { prisma } from '@mtv/db';

const WEB = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
const ACCOUNTS = [
  { email: 'demo-free@mytradingview.in', name: 'Demo Free', plan: 'FREE' as const },
  { email: 'demo-live@mytradingview.in', name: 'Demo Live', plan: 'LIVE' as const },
];
const recreate = process.argv.includes('--recreate');
// Readable password: no 0/O/1/l/I.
const password = () => Array.from(randomBytes(14), (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 55]).join('');

for (const a of ACCOUNTS) {
  let user = await prisma.user.findUnique({ where: { email: a.email } });
  if (user && recreate) {
    await prisma.user.delete({ where: { id: user.id } }); // cascades to sessions, subscriptions, paper account
    user = null;
  }
  let pw: string | null = null;
  if (!user) {
    pw = password();
    const res = await fetch(`${WEB}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WEB },
      body: JSON.stringify({ name: a.name, email: a.email, password: pw }),
    });
    if (!res.ok) throw new Error(`Sign-up failed for ${a.email}: HTTP ${res.status} ${await res.text()}`);
    user = await prisma.user.findUniqueOrThrow({ where: { email: a.email } });
  }
  if (a.plan === 'LIVE') {
    const end = new Date();
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    await prisma.subscription.upsert({
      where: { providerSubscriptionId: `demo_${user.id}` },
      create: { userId: user.id, plan: 'LIVE', interval: 'year', status: 'ACTIVE', provider: 'billing-sandbox', providerSubscriptionId: `demo_${user.id}`, currentPeriodEnd: end },
      update: { status: 'ACTIVE', currentPeriodEnd: end, cancelAtPeriodEnd: false },
    });
  }
  console.log(`${a.email.padEnd(30)} ${a.plan.padEnd(5)} ${pw ? `password: ${pw}` : '(already exists: password unchanged; use --recreate for a new one)'}`);
}
await prisma.$disconnect();
