// SITE_MODE=landing publishes only the marketing and legal pages (for going live before licensed market data is in
// place). Anything else (sign-up, terminal, pricing, APIs) is switched off by the middleware.
export const LANDING = process.env.SITE_MODE === 'landing';

/** Pages served in landing mode. Static files (images, icons, /_next) are allowed by the middleware matcher. */
export const LANDING_PATHS = new Set(['/', '/disclaimer', '/terms', '/privacy']);
