// Analysis tools, one page each. Plain module: read by server pages (metadata) and client components (navigation).
// status 'coming': needs intraday data, which this site does not publish; the page explains that.

export type ToolGroup = 'options' | 'futures' | 'market' | 'utility';
export type Tool = { slug: string; group: ToolGroup; label: string; description: string; status?: 'coming' };

export const OPTION_TOOLS: Tool[] = [
  { slug: 'open-interest', group: 'options', label: 'Open interest', description: 'Call and put open interest by strike, its change from the previous day, and volume.' },
  { slug: 'pcr', group: 'options', label: 'Put-call ratio', description: 'Put open interest divided by call open interest, day by day, with the volume ratio.' },
  { slug: 'max-pain', group: 'options', label: 'Max pain', description: 'The strike where option buyers would collect the least at expiry, and how it compared with the expiry close.' },
  { slug: 'straddle', group: 'options', label: 'Straddle & strangle', description: 'ATM straddle premium day by day, and strangle premiums at each distance from ATM.' },
  { slug: 'decay', group: 'options', label: 'Premium decay', description: 'How the ATM straddle premium shrank as expiry came closer, expiry against expiry.' },
  { slug: 'pe-ce', group: 'options', label: 'PE − CE difference', description: 'Put minus call open interest by day, with the change-in-OI ratio. Download as CSV.' },
  { slug: 'multi-strike', group: 'options', label: 'Multi-strike', description: 'Premium, open interest or volume of up to six strikes on one chart.' },
  { slug: 'price-vs-oi', group: 'options', label: 'Price vs OI', description: 'The underlying price against total option open interest and futures open interest.' },
  { slug: 'contract', group: 'options', label: 'Contract history', description: 'Daily premium, open interest, volume and IV of one option contract, including expired ones.' },
  { slug: 'timeseries', group: 'options', label: 'Chain over time', description: 'One expiry’s strikes across recent sessions: open interest or premium in a date-by-strike grid.' },
  { slug: 'iv', group: 'options', label: 'IV & HV', description: '30-day implied volatility, 20-day historical volatility, IV rank and IV percentile.' },
  { slug: 'skew', group: 'options', label: 'Skew & term structure', description: 'IV across strikes for each expiry, and ATM IV across expiries.' },
  { slug: 'iv-grid', group: 'options', label: 'IV table', description: 'IV, HV, IV rank and IV percentile of every F&O index and stock on one page.' },
  { slug: 'vega', group: 'options', label: 'Vega', description: 'Vega of the open interest at each strike: how much the book gains or loses per 1 point of IV.' },
  { slug: 'gex', group: 'options', label: 'Gamma exposure', description: 'Gamma exposure by strike, the call and put walls, and the level where it changes sign.' },
  { slug: 'oi-spurts', group: 'options', label: 'OI changes & crossovers', description: 'Contracts that added or shed the most open interest, and strikes where put and call OI crossed.' },
  { slug: 'oi-clusters', group: 'options', label: 'Unusual OI', description: 'Strikes whose open interest changed far more than their own 20-day average. The rule is shown.' },
  { slug: 'strategy-chart', group: 'options', label: 'Strategy chart', description: 'The combined premium of your own legs, day by day, against the underlying.' },
];

/** Futures pages: the overview at /futures and the tools at /futures/<slug>. */
export const FUTURES_TOOLS: Tool[] = [
  { slug: 'movers', group: 'futures', label: 'Movers & heatmap', description: 'Every F&O future on one day: price change, open-interest change and build-up, as a table or a heatmap.' },
  { slug: 'oi-cycle', group: 'futures', label: 'Build-up cycle', description: 'How often each future was in long build-up, short build-up, short covering or long unwinding over recent sessions.' },
];

/** Market-wide pages at /market/<slug>. */
export const MARKET_TOOLS: Tool[] = [
  { slug: 'rrg', group: 'market', label: 'Sector rotation', description: 'Where each NSE sector index stands against the NIFTY: relative strength and its momentum, with the path it took.' },
  { slug: 'breadth', group: 'market', label: 'Advance / decline', description: 'How many members of an index rose or fell each day, the cumulative advance-decline line, and members above their averages.' },
];

/** Utilities at /tools/<slug>. */
export const UTILITY_TOOLS: Tool[] = [
  { slug: 'lot-size', group: 'utility', label: 'F&O lot sizes', description: 'The lot size of every NSE F&O index and stock today, and when each one last changed.' },
  { slug: 'sip', group: 'utility', label: 'SIP calculator', description: 'What a monthly investment grows to: at a return you choose, or on the NIFTY 50’s actual closes.' },
];

export const isOptionTool = (slug: string) => OPTION_TOOLS.some((t) => t.slug === slug);

/** Default underlying for tools, kept in the URL as ?u=. */
export const DEFAULT_UNDERLYING = 'NIFTY';
