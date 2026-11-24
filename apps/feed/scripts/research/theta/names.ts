import { prisma } from '@mtv/db';
const r = await prisma.$queryRawUnsafe<any[]>(`SELECT name, MIN(date) mn, MAX(date) mx FROM "IndexEod" WHERE name ILIKE '%FIN%' OR name ILIKE '%MID%SEL%' OR name IN ('NIFTY 50','NIFTY BANK') GROUP BY name`);
console.log(r);
const lots = await prisma.$queryRawUnsafe<any[]>(`SELECT underlying, MAX(date) d FROM "FnoDayMeta" GROUP BY underlying`);
console.log(lots.filter(x=>['NIFTY','FINNIFTY','BANKNIFTY','MIDCPNIFTY'].includes(x.underlying)));
await prisma.$disconnect();
