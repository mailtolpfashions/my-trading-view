// One switch for the two ways this codebase runs (docs/public-site/01-phase1-plan.md, milestone 1):
//   personal (default)  the owner's app on the PC: Kite live data, Trade lab, paper tests, autopilot, research
//   public              the website: NSE end-of-day tools for visitors; nothing that uses the owner's Kite session,
//                       the owner's research results or the single-user store
// Set APP_MODE=public in .env (the platform also needs it at build time; next.config passes it to the browser).
// The lists below are the single source for both apps: the platform hides and refuses the pages, the feed refuses
// the routes and does not start the owner's background jobs.

export type AppMode = 'personal' | 'public';

export const appMode = (v: string | undefined = typeof process !== 'undefined' ? process.env.APP_MODE ?? process.env.NEXT_PUBLIC_APP_MODE : undefined): AppMode =>
  v?.trim().toLowerCase() === 'public' ? 'public' : 'personal';

/** Platform pages that exist only in the owner's app (path prefixes). */
export const PERSONAL_PAGES = [
  '/tradelab', // paper trading on the owner's Kite quotes
  '/alerts', // alerts send to the owner's Telegram/email (per-user alerts come with accounts)
  '/connect', // the owner's Kite connection (users connect their own broker in milestone 3)
  '/research/quant', // the owner's research programme results
  '/options/intraday-seller', // live seller engine on the owner's Kite data
  '/options/selling-report', // the owner's selling research
  '/options/selling-study',
  '/tools/paper-log', // the owner's 9:30 paper log
] as const;

/**
 * Feed routes (path after /api/) that exist only in the owner's app. `user/` (saved screens, watchlists, strategies) is
 * NOT here: on the public site the feed's user store is empty and read-only until accounts (milestone 2).
 */
export const PERSONAL_ROUTES: RegExp[] = [
  /^tradelab(\/|$)/,
  /^seller(\/|$)/,
  /^paperlog(\/|$)/,
  /^kite(\/|$)/,
  /^intraday(\/|$)/,
  /^quant(\/|$)/,
  /^selling-/,
  /^alerts(\/|$)/,
  /^alert-events(\/|$)/,
];

/** True if the page (a pathname) is owner-only. */
export const isPersonalPage = (pathname: string) => PERSONAL_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** True if the feed route (with or without a leading /api/) is owner-only. */
export const isPersonalRoute = (route: string) => {
  const r = route.replace(/^\/?(api\/)?/, '').split('?')[0];
  return PERSONAL_ROUTES.some((x) => x.test(r));
};
