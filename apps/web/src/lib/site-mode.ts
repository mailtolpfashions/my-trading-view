// SITE_MODE=landing publishes only the marketing and legal pages (for going live before licensed market data is in
// place). Anything else (sign-up, terminal, pricing, APIs) is switched off by the middleware.
export const LANDING = process.env.SITE_MODE === 'landing';

/**
 * The site is free while it builds an audience: visitors get a few runs a day, signing in (Google) removes the limit.
 * NEXT_PUBLIC_PAID_PLANS=1 brings back pricing, upgrades and checkout when paid plans launch.
 */
export const PAID_PLANS = process.env.NEXT_PUBLIC_PAID_PLANS === '1';

/** Pages served in landing mode. Static files (images, icons, /_next) are allowed by the middleware matcher. */
export const LANDING_PATHS = new Set(['/', '/disclaimer', '/terms', '/privacy']);
