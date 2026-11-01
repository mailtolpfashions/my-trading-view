import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { headers } from 'next/headers';
import { cache } from 'react';
import { prisma } from '@mtv/db';

/** Google sign-in is on once GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (Google Cloud OAuth client). */
export const googleLoginEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
  ...(googleLoginEnabled() && {
    socialProviders: { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, prompt: 'select_account' as const } },
  }),
  session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24, cookieCache: { enabled: true, maxAge: 5 * 60 } },
  rateLimit: { enabled: true, window: 60, max: 30 },
  // nextCookies lets Server Actions set cookies; keep it last.
  plugins: [nextCookies()],
});

/** Current session (or null), memoised per request. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));
