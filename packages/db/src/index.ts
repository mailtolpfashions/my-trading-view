import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/** One client per process. */
export const prisma = new PrismaClient();

/** BigInt paise from the database -> number, refusing values outside the exact-integer range. */
export function paise(v: bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`Amount out of range: ${v}`);
  return n;
}
