import 'server-only';
import { prisma } from '@mtv/db';
import type { PlanId } from '@/lib/plans';

/**
 * A user is on LIVE while they have a subscription whose paid period has not ended: ACTIVE, or CANCELLED with access
 * until the period end. HALTED (payment failed) and PENDING (checkout not completed) give no paid access.
 */
export async function currentPlan(userId: string, now = new Date()): Promise<{ plan: PlanId; until: Date | null }> {
  const sub = await prisma.subscription.findFirst({
    where: { userId, plan: 'LIVE', status: { in: ['ACTIVE', 'CANCELLED'] }, currentPeriodEnd: { gt: now } },
    orderBy: { currentPeriodEnd: 'desc' },
  });
  return sub ? { plan: 'LIVE', until: sub.currentPeriodEnd } : { plan: 'FREE', until: null };
}
