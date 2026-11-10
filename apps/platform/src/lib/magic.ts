// Magic filters: everyday scan phrases turned into conditions, offline and predictably. Two passes:
// 1. known phrases ("stocks at 52 week high", "5 red candles on 5-min", "close between 100 and 2000", candle patterns,
//    "supertrend and macd positive", "SMA50 in uptrend since last 20 days", "gap up 2%");
// 2. a written comparison in plain words or symbols ("5-minute volume > 2 x 5-minute SMA(volume,10)", "daily rsi(14)
//    crossed above 60"), turned into the formula language and checked by its parser.
// A phrase it can't read is reported as not understood; it never guesses.

import { PATTERNS, parseFormula } from '@mtv/rules';

export type MagicResult = { ok: true; conditions: string[]; read: string } | { ok: false; error: string };

const TF_WORDS: [RegExp, string][] = [
  [/\b(?:1|one)[ -]?(?:minute|min|mins|minutes|m)\b/g, '[1m]'], [/\b3[ -]?(?:minute|min|mins|minutes|m)\b/g, '[3m]'],
  [/\b5[ -]?(?:minute|min|mins|minutes|m)\b/g, '[5m]'], [/\b15[ -]?(?:minute|min|mins|minutes|m)\b/g, '[15m]'],
  [/\b30[ -]?(?:minute|min|mins|minutes|m)\b/g, '[30m]'], [/\b(?:60[ -]?(?:minute|min|mins|minutes)|1[ -]?(?:hour|hr|h)|hourly)\b/g, '[1h]'],
  [/\b(?:daily|day)\b/g, '[D]'], [/\b(?:weekly|week)\b/g, '[W]'], [/\b(?:monthly|month)\b/g, '[M]'],
];
const tfOf = (s?: string) => {
  if (!s) return '';
  let out = s;
  for (const [re, tf] of TF_WORDS) out = out.replace(re, tf);
  return /^\[[^\]]+\]$/.test(out.trim()) ? `${out.trim()} ` : '';
};
/** Everyday names that differ from the pattern list's ("three black soldiers" is a common mix-up of the crows). */
const PATTERN_ALIASES: Record<string, string> = { 'three black soldiers': 'THREE_BLACK_CROWS', 'engulfing': 'BULLISH_ENGULFING', 'bullish engulf': 'BULLISH_ENGULFING', 'bearish engulf': 'BEARISH_ENGULFING', 'doji candle': 'DOJI' };
const patternName = (s: string) => PATTERN_ALIASES[s.trim()] ?? PATTERNS.find((p) => p.name.toLowerCase().replace(/_/g, ' ') === s.trim())?.name;

/** Known phrases first: each returns the conditions it stands for. */
const PHRASES: { re: RegExp; make: (m: RegExpMatchArray) => string[] | null }[] = [
  { re: /^(?:stocks? )?(?:at|making|hitting|on|touching|new)? ?(?:a |the )?(?:new )?52[- ]?w(?:ee)?k(?: high)$|^(?:stocks? )?(?:at |making |hitting |new )?(?:a |the )?(?:new )?52[- ]?week high$/, make: () => ['[D] HIGH >= [D] HIGHEST(HIGH, 252)'] },
  { re: /^(?:stocks? )?(?:at |making |hitting |new )?(?:a |the )?(?:new )?52[- ]?week low$/, make: () => ['[D] LOW <= [D] LOWEST(LOW, 252)'] },
  { re: /^(?:stocks? )?(?:near|close to|within ([\d.]+) ?% of) (?:the |its )?52[- ]?week high$/, make: (m) => [`CLOSE >= [D] HIGHEST(HIGH, 252) * (1 - ${m[1] ?? 3} / 100)`] },
  { re: /^(?:latest |last |current )?(?:close|price|ltp) (?:is )?between ([\d.]+) and ([\d.]+)$/, make: (m) => [`CLOSE >= ${m[1]}`, `CLOSE <= ${m[2]}`] },
  { re: /^(?:consecutive |last )?(\d+) (?:consecutive )?(red|green) candles?(?: (?:on|in) (.+))?$/, make: (m) => {
    const n = Number(m[1]);
    if (!(n >= 1 && n <= 20)) return null;
    const tf = tfOf(m[3]);
    if (m[3] && !tf) return null;
    return Array.from({ length: n }, (_, k) => `${tf}CLOSE${k ? `[${k}]` : ''} ${m[2] === 'red' ? '<' : '>'} ${tf}OPEN${k ? `[${k}]` : ''}`);
  } },
  { re: /^(?:a |an )?([a-z ]+?)(?: candle| pattern)?(?: (?:on|in) (.+))?$/, make: (m) => {
    const name = patternName(m[1]);
    if (!name) return null;
    const tf = tfOf(m[2]);
    if (m[2] && !tf) return null;
    return [`${tf}${name}`];
  } },
  { re: /^supertrend(?: ?\((\d+), ?(\d+)\))? (?:is )?(bullish|positive|buy|green|up)$/, make: (m) => [`SUPERTREND_DIR(${m[1] ?? 10}, ${m[2] ?? 3}) = 1`] },
  { re: /^supertrend(?: ?\((\d+), ?(\d+)\))? (?:is )?(bearish|negative|sell|red|down)$/, make: (m) => [`SUPERTREND_DIR(${m[1] ?? 10}, ${m[2] ?? 3}) = -1`] },
  { re: /^supertrend and macd (?:are )?(positive|bullish)$/, make: () => ['SUPERTREND_DIR(10, 3) = 1', 'MACD_LINE(CLOSE, 12, 26, 9) > MACD_SIGNAL(CLOSE, 12, 26, 9)'] },
  { re: /^macd (?:is )?(positive|above zero)$/, make: () => ['MACD_LINE(CLOSE, 12, 26, 9) > 0'] },
  { re: /^macd (?:is )?(negative|below zero)$/, make: () => ['MACD_LINE(CLOSE, 12, 26, 9) < 0'] },
  { re: /^macd (?:bullish crossover|crossed above (?:its )?signal)$/, make: () => ['CROSSOVER(MACD_LINE(CLOSE, 12, 26, 9), MACD_SIGNAL(CLOSE, 12, 26, 9))'] },
  { re: /^(sma|ema) ?(\d+) (?:is )?(?:in (?:an )?uptrend|rising)(?: (?:since|for|over) (?:the )?(?:last )?(\d+) (?:days?|candles?|bars?))?$/, make: (m) => [`${m[1].toUpperCase()}(CLOSE, ${m[2]}) > ${m[1].toUpperCase()}(CLOSE, ${m[2]})[${m[3] ?? 1}]`] },
  { re: /^(sma|ema) ?(\d+) (?:is )?(?:in (?:a )?downtrend|falling)(?: (?:since|for|over) (?:the )?(?:last )?(\d+) (?:days?|candles?|bars?))?$/, make: (m) => [`${m[1].toUpperCase()}(CLOSE, ${m[2]}) < ${m[1].toUpperCase()}(CLOSE, ${m[2]})[${m[3] ?? 1}]`] },
  { re: /^gap(?:ped)? up(?: by)?(?: more than)? ([\d.]+) ?%$/, make: (m) => [`[D] GAP_PCT > ${m[1]}`] },
  { re: /^gap(?:ped)? down(?: by)?(?: more than)? ([\d.]+) ?%$/, make: (m) => [`[D] GAP_PCT < -${m[1]}`] },
  { re: /^(?:stocks? )?(?:up|gained|rose)(?: by)?(?: more than)? ([\d.]+) ?% today$/, make: (m) => [`[D] CHANGE_PCT(CLOSE, 1) > ${m[1]}`] },
  { re: /^(?:stocks? )?(?:down|lost|fell)(?: by)?(?: more than)? ([\d.]+) ?% today$/, make: (m) => [`[D] CHANGE_PCT(CLOSE, 1) < -${m[1]}`] },
  { re: /^(?:price |close )?above vwap$/, make: () => ['CLOSE > VWAP'] },
  { re: /^(?:price |close )?below vwap$/, make: () => ['CLOSE < VWAP'] },
  { re: /^volume (?:spike|surge|shocker)$/, make: () => ['VOLUME > 2 * SMA(VOLUME, 20)'] },
];

/** A written comparison in words or symbols, turned into the formula language. */
function translate(text: string): string {
  let s = ` ${text} `;
  // Operators in words (longest first), "crossed above" kept for the crossing step below.
  s = s.replace(/\bcross(?:ed|es|ing)? (?:over|above)\b/g, ' __XUP__ ').replace(/\bcross(?:ed|es|ing)? (?:under|below)\b/g, ' __XDN__ ');
  s = s.replace(/\b(?:is )?greater than or equal to\b/g, ' >= ').replace(/\b(?:is )?less than or equal to\b/g, ' <= ');
  s = s.replace(/\b(?:is )?(?:greater than|more than|above|higher than)\b/g, ' > ').replace(/\b(?:is )?(?:less than|below|lower than|under)\b/g, ' < ');
  s = s.replace(/\b(?:is )?(?:equal to|equals)\b/g, ' = ');
  s = s.replace(/\[0\]\s*/g, ''); // Chartink's "[0]" = the latest candle, which is the default here
  // Timeframe words before a value become [tf].
  for (const [re, tf] of TF_WORDS) s = s.replace(re, ` ${tf} `);
  // Prices and values.
  s = s.replace(/\b(?:latest |last |current )?(?:ltp|price)\b/g, 'close');
  s = s.replace(/(\d)\s*[x×]\s*(?=[a-z[(\d])/g, '$1 * ').replace(/\s[x×]\s/g, ' * ');
  s = s.replace(/\b(sma|ema|wma|rsi)\s?(\d+)\b(?!\s*,)/g, (_, f: string, n: string) => `${f}(close, ${n})`); // sma50, rsi 14
  s = s.replace(/\b(sma|ema|wma|rsi)\s*\(\s*(\d+)\s*\)/g, (_, f: string, n: string) => `${f}(close, ${n})`); // rsi(14)
  s = s.replace(/\brsi\b(?!\s*\()/g, 'rsi(close, 14)');
  s = s.replace(/\bsupertrend\b(?!\s*[(_])/g, 'supertrend(10, 3)');
  s = s.replace(/\bmacd\b(?!\s*[(_])/g, 'macd_line(close, 12, 26, 9)').replace(/\bmacd signal\b/g, 'macd_signal(close, 12, 26, 9)');
  s = s.replace(/\bvol\b/g, 'volume');
  // Capitals for the formula language, but minute and hour markers stay lower case ([5M] would mean 5 months).
  s = s.toUpperCase().replace(/\[(\d+)M\]/g, '[$1m]').replace(/\[1H\]/g, '[1h]').replace(/\s+/g, ' ').trim();
  // Crossing: A crossed above B → CROSSOVER(A, B).
  const cross = /^(.+?) __XUP__ (.+)$/.exec(s) ?? null;
  if (cross) return `CROSSOVER(${cross[1]}, ${cross[2]})`;
  const crossDn = /^(.+?) __XDN__ (.+)$/.exec(s) ?? null;
  if (crossDn) return `CROSSUNDER(${crossDn[1]}, ${crossDn[2]})`;
  return s;
}

/** Reads one phrase (or several, one per line or separated by ";"), all or nothing. */
export function readMagic(input: string): MagicResult {
  const parts = input.split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return { ok: false, error: 'Type what you want to find, e.g. "5-minute volume > 2 x 5-minute SMA(volume, 10)"' };
  const out: string[] = [];
  for (const raw of parts) {
    const text = raw.toLowerCase().replace(/[“”]/g, '"').replace(/\s+/g, ' ').replace(/^(?:stocks? (?:where|with|whose|that) )/, '').trim();
    let got: string[] | null = null;
    for (const ph of PHRASES) { const m = text.match(ph.re); if (m) { got = ph.make(m); if (got) break; } }
    if (!got) {
      const f = translate(text);
      const p = parseFormula(f);
      if (p.ok && p.type === 'bool') got = [p.formula];
      else return { ok: false, error: `Didn't understand "${raw}". Try a comparison like "daily rsi(14) > 60" or "5 minute close crossed above vwap", or a phrase like "stocks at 52 week high".` };
    }
    for (const g of got) {
      const p = parseFormula(g);
      if (!p.ok || p.type !== 'bool') return { ok: false, error: `Couldn't turn "${raw}" into a condition` };
      out.push(p.formula);
    }
  }
  return { ok: true, conditions: out, read: out.join('  AND  ') };
}

/** Examples shown under the box (each one works). */
export const MAGIC_EXAMPLES = [
  '5-minute volume > 2 x 5-minute SMA(volume, 10)',
  'stocks at 52 week high',
  'latest close between 100 and 2000',
  '3 red candles on 5 min',
  'supertrend and macd positive',
  'SMA50 in uptrend since last 20 days',
  'daily rsi(14) crossed above 60',
  'bullish engulfing on daily',
  'gap up 2%',
];
