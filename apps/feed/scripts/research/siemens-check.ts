import { prisma } from '@mtv/db';
import { dailyHistory, loadEod } from '../../src/eod/store';
await loadEod(() => {});
const h = dailyHistory('SIEMENS')!;
console.log('adjustments', JSON.stringify(h.adjustments.slice(-4)), 'breaks', h.breaks.slice(-4), 'unhandled', JSON.stringify(h.unhandled.slice(-3)));
await prisma.$disconnect(); process.exit(0);
