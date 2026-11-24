// The app mode as the browser and server components see it (personal = the owner's app, public = the website).
// NEXT_PUBLIC_APP_MODE is set from APP_MODE at build time (next.config.ts); it must be read literally here so Next
// inlines it. The lists of what the public site leaves out live in @mtv/shared/mode.
import { appMode, isPersonalPage } from '@mtv/shared/mode';

export const MODE = appMode(process.env.NEXT_PUBLIC_APP_MODE);
export const PERSONAL = MODE === 'personal';
/** True if this link may be shown in the current mode. */
export const shown = (href: string) => PERSONAL || !isPersonalPage(href.split('?')[0]);
