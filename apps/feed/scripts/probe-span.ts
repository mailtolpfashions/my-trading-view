// Checks which past SPAN files NSE's archive serves and whether they parse: npx tsx scripts/probe-span.ts 2024-01-15 ...
import { spanOn } from '../src/fno/span';
for (const d of process.argv.slice(2)) {
  const s = await spanOn(d, 'NIFTY');
  console.log(d, s ? `ok ${s.data.NIFTY?.file} contracts=${s.data.NIFTY ? 'parsed' : 'none'}` : 'unavailable');
}
