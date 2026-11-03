// The one live-data service of this process, shared by the screener, the chart routes and the Kite login routes.

import { LiveService } from './live';

let log: (m: string) => void = (m) => console.log(m);
export const setLiveLog = (fn: (m: string) => void) => { log = fn; };
export const live = new LiveService((m) => log(m));
