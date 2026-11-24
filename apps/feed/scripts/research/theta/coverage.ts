import { prisma } from '@mtv/db';
const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT underlying, MIN(date) mn, MAX(date) mx, COUNT(DISTINCT expiry) ne FROM "FnoEod" WHERE underlying IN ('NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','SENSEX') AND kind='CE' GROUP BY underlying`);
console.log(rows.map(r=>({...r, ne:Number(r.ne)})));
await prisma.$disconnect();
