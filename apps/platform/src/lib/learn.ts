// Learn articles: short, plain explanations of the ideas behind the tools. Written for this site; each links to the
// tool where the idea can be seen on NSE's own data. Facts that NSE changes often (lot sizes, rates, expiry days) are
// described in general terms and left to the live pages. Plain module: read by server pages.

export type Article = {
  slug: string;
  title: string;
  /** One line for the index page. */
  summary: string;
  topic: 'Options basics' | 'Open interest' | 'Volatility' | 'Market data' | 'Trading mechanics';
  sections: { h?: string; p: string[] }[];
  /** Tools on this site that show the idea. */
  tools: { href: string; label: string }[];
};

export const ARTICLES: Article[] = [
  {
    slug: 'option-chain', topic: 'Options basics', title: 'Reading an option chain',
    summary: 'What each column means and how to find your way around one expiry.',
    sections: [
      { p: ['An option chain lists every call and put of one underlying and one expiry, one strike per row. Calls sit on the left and puts on the right, with the strike in the middle, so you can compare both sides of the same strike at a glance.'] },
      { h: 'The columns', p: ['Premium is the price of one unit of the option; multiply by the lot size for one contract. Open interest (OI) is how many contracts are still open, and its change shows what was added or closed since the previous day. Volume is how many contracts traded. IV is the volatility the premium implies.', 'On this site every number is from NSE’s official end-of-day file, so premiums are closing prices, not live quotes. A premium marked * did not trade that day; NSE carried its previous close forward.'] },
      { h: 'Where to look first', p: ['Find the at-the-money (ATM) strike, nearest the underlying’s price. Calls below it and puts above it are in the money: they already have intrinsic value. The rest is time value, which shrinks as expiry comes closer.'] },
    ],
    tools: [{ href: '/options', label: 'Option chain' }, { href: '/options/open-interest', label: 'Open interest' }],
  },
  {
    slug: 'option-greeks', topic: 'Options basics', title: 'The option Greeks',
    summary: 'Delta, gamma, theta and vega: how a premium responds to price, time and volatility.',
    sections: [
      { p: ['The Greeks describe how an option’s premium changes when one thing changes and the rest stays the same. They come from a pricing model, so they are estimates, but they make a position’s risks easy to compare.'] },
      { h: 'The four that matter most', p: ['Delta: the change in premium for a 1-point move in the underlying. A call’s delta is between 0 and 1, a put’s between −1 and 0; at the money it is about ±0.5.', 'Gamma: how fast delta itself changes as the underlying moves. It is largest at the money and close to expiry.', 'Theta: the change in premium for one day passing, usually negative for a buyer. Time decay speeds up near expiry.', 'Vega: the change in premium for a 1-point change in implied volatility. Longer-dated options have more vega.'] },
      { h: 'For a whole position', p: ['Add each leg’s Greek × quantity (buys positive, sells negative). The strategy builder does this and shows the total delta, theta and vega of your legs. This site uses the Black-76 model on the forward price implied by put-call parity.'] },
    ],
    tools: [{ href: '/options', label: 'Strategy builder' }, { href: '/options/vega', label: 'Vega by strike' }],
  },
  {
    slug: 'implied-volatility', topic: 'Volatility', title: 'Implied volatility',
    summary: 'The volatility an option’s price assumes, and how it differs from what the market actually did.',
    sections: [
      { p: ['A pricing model turns five inputs into a premium: the underlying price, the strike, time to expiry, the interest rate and volatility. Four of them are known. Implied volatility (IV) is the volatility that makes the model’s price equal the market’s premium.'] },
      { h: 'IV and historical volatility', p: ['Historical volatility (HV) measures how much the price actually moved, from past closes. IV is what option prices assume for the time left to expiry. When IV is well above HV, options are priced for bigger moves than recent ones; when it is below, for smaller ones. Neither tells you which way the price will go.'] },
      { h: 'Skew and term structure', p: ['IV is not the same for every strike: out-of-the-money puts often carry higher IV than calls (the skew). Nor for every expiry: the term structure shows ATM IV across expiries. Both are on the skew page.'] },
    ],
    tools: [{ href: '/options/iv', label: 'IV & HV' }, { href: '/options/skew', label: 'Skew & term structure' }],
  },
  {
    slug: 'iv-rank-vs-iv-percentile', topic: 'Volatility', title: 'IV rank and IV percentile',
    summary: 'Two ways of asking “is IV high or low for this underlying?”, and why they can disagree.',
    sections: [
      { p: ['A level of IV means little on its own: 20% is high for one index and low for a volatile stock. IV rank and IV percentile compare today’s IV with the underlying’s own past year (252 sessions here).'] },
      { h: 'The difference', p: ['IV rank places today between the year’s lowest IV (0) and highest (100). One spike can stretch the range and keep the rank low for months.', 'IV percentile is the share of past days with a lower IV than today. It is less affected by a single extreme day.'] },
      { h: 'Using them', p: ['Use them to compare an underlying with itself, or to scan many at once on the IV table. They say where IV sits, not where it will go next.'] },
    ],
    tools: [{ href: '/options/iv', label: 'IV & HV' }, { href: '/options/iv-grid', label: 'IV table' }],
  },
  {
    slug: 'premium-decay', topic: 'Options basics', title: 'Time decay of option premiums',
    summary: 'Why time value falls as expiry approaches, and why it falls faster near the end.',
    sections: [
      { p: ['An option’s premium is intrinsic value plus time value. At expiry only intrinsic value is left, so time value falls to zero along the way. This loss is time decay, measured by theta.'] },
      { h: 'Not a straight line', p: ['Decay is slow when expiry is far away and fast in the last days, most of all for at-the-money options. That is why the ATM straddle (call plus put at the money) is a clean way to watch it: it is almost all time value.'] },
      { h: 'Volatility gets in the way', p: ['A rise in implied volatility adds to time value and can hide decay for a while; a fall speeds it up. The premium-decay page plots several past expiries on one chart against days to expiry, so you can see how this played out.'] },
    ],
    tools: [{ href: '/options/decay', label: 'Premium decay' }, { href: '/options/straddle', label: 'Straddle & strangle' }],
  },
  {
    slug: 'atm-straddle', topic: 'Options basics', title: 'The ATM straddle',
    summary: 'A call and a put at the same strike: what its price tells you about the expected move.',
    sections: [
      { p: ['A straddle is a call and a put with the same strike and expiry. At the money, its combined premium is roughly the move the market is pricing in by expiry, in either direction.'] },
      { h: 'Reading it', p: ['Divide the straddle premium by the underlying price to compare across levels: a ₹230 straddle on a 23,000 index is 1% of spot. Breakevens at expiry are the strike plus and minus the premium.', 'A buyer needs a move larger than the premium; a seller keeps the premium if the move is smaller, and has open-ended risk otherwise.'] },
      { h: 'Strangles', p: ['A strangle uses an out-of-the-money call and put instead, so it is cheaper and needs a bigger move. The straddle page lists strangle premiums at each width.'] },
    ],
    tools: [{ href: '/options/straddle', label: 'Straddle & strangle' }, { href: '/options', label: 'Strategy builder' }],
  },
  {
    slug: 'vertical-spreads', topic: 'Options basics', title: 'Bull and bear spreads',
    summary: 'Buying one option and selling another to cap both the cost and the payoff.',
    sections: [
      { p: ['A vertical spread buys one option and sells another of the same type and expiry at a different strike. The sold option pays for part of the bought one, and caps the profit in return.'] },
      { h: 'The four basic spreads', p: ['Bull call spread: buy a call, sell a higher-strike call. Profits if the price rises, up to the gap between strikes minus the net premium paid.', 'Bull put spread: sell a put, buy a lower-strike put. Collects a premium and keeps it if the price stays above the sold strike.', 'Bear put spread and bear call spread are the mirror images for a falling price.'] },
      { h: 'What to check', p: ['Maximum profit, maximum loss and the breakeven are all known at entry. Charges matter more than they seem on narrow spreads, and holding an in-the-money long leg to expiry adds exercise STT; the strategy builder shows both.'] },
    ],
    tools: [{ href: '/options', label: 'Strategy builder' }, { href: '/options/strategy-chart', label: 'Strategy chart' }],
  },
  {
    slug: 'open-interest', topic: 'Open interest', title: 'Open interest',
    summary: 'The number of contracts still open, and what a change in it does and does not tell you.',
    sections: [
      { p: ['Every futures or options contract has a buyer and a seller. Open interest (OI) counts the contracts still open at the end of the day. It rises when new positions are opened and falls when existing ones are closed.'] },
      { h: 'Reading OI in options', p: ['Strikes with large OI are where many positions sit. Large call OI above the price and large put OI below are often read as levels traders are positioned around. They are positions, not promises: they can be closed at any time.', 'NSE publishes OI in shares; divide by the lot size for contracts.'] },
      { h: 'Change in OI', p: ['A big addition at a strike shows new positions there, but not who is long or short. Combining the OI change with the premium change (build-up) helps, and the participant-wise data shows which groups hold what.'] },
    ],
    tools: [{ href: '/options/open-interest', label: 'Open interest' }, { href: '/options/oi-spurts', label: 'OI changes & crossovers' }],
  },
  {
    slug: 'oi-vs-volume', topic: 'Open interest', title: 'Open interest and volume',
    summary: 'Volume counts trades during the day; open interest counts positions left at the close.',
    sections: [
      { p: ['Volume is the number of contracts that changed hands during the day. Open interest is the number still open at the end of it. The two measure different things and often move differently.'] },
      { h: 'An example', p: ['If one trader opens a position and closes it the same day, volume goes up and open interest does not change. If a new buyer and a new seller each open a contract and hold it, both go up by one.'] },
      { h: 'Why both are useful', p: ['High volume with little OI change suggests intraday activity; rising OI shows positions being carried overnight. On this site, volume comes from NSE’s end-of-day file in contracts, and OI in shares.'] },
    ],
    tools: [{ href: '/options/multi-strike', label: 'Multi-strike' }, { href: '/options/open-interest', label: 'Open interest' }],
  },
  {
    slug: 'build-up', topic: 'Open interest', title: 'Long and short build-up',
    summary: 'Reading price change together with open-interest change.',
    sections: [
      { p: ['Price alone does not say whether positions are being opened or closed. Combining the day’s price change with the change in open interest gives four labels.'] },
      { h: 'The four cases', p: ['Price up, OI up: long build-up (new buying).', 'Price down, OI up: short build-up (new selling).', 'Price up, OI down: short covering (shorts closing).', 'Price down, OI down: long unwinding (longs closing).'] },
      { h: 'Using it carefully', p: ['The labels are a convention, not a fact about who traded: every contract has both a buyer and a seller. Compare the same contract with itself day to day; comparing this month’s contract with last month’s across a roll gives false readings. The futures pages do this for you.'] },
    ],
    tools: [{ href: '/futures/movers', label: 'Futures movers' }, { href: '/futures/oi-cycle', label: 'Build-up cycle' }],
  },
  {
    slug: 'participant-oi', topic: 'Market data', title: 'Participant-wise open interest',
    summary: 'How clients, DIIs, FIIs and proprietary traders are positioned in F&O.',
    sections: [
      { p: ['NSE publishes every day how many index and stock futures and options contracts four groups hold, long and short: Clients (individuals and others), DIIs (domestic institutions), FIIs (foreign institutions) and Pro (brokers trading their own money).'] },
      { h: 'What to look at', p: ['The net position (long minus short) of each group in index futures, and in index calls and puts, and how it changes over days. FIIs’ index-futures positioning is followed closely because their positions are large.'] },
      { h: 'Limits', p: ['The data is published after the close and counts contracts, not money. A net short position may be a hedge against shares held in the cash market, so it does not tell you a group’s overall view.'] },
    ],
    tools: [{ href: '/research/fii', label: 'FII footprints' }, { href: '/dashboard', label: 'Dashboard' }],
  },
  {
    slug: 'put-call-ratio', topic: 'Open interest', title: 'The put-call ratio',
    summary: 'Put open interest divided by call open interest, and why to read it against its own history.',
    sections: [
      { p: ['The put-call ratio (PCR) divides total put open interest by total call open interest for an expiry. A volume PCR does the same with the day’s traded volume.'] },
      { h: 'How it is read', p: ['A PCR above 1 means more puts are open than calls. Because option writers are often the larger players, some read a high PCR as put writers expecting support below. Others read the same number the opposite way. There is no fixed level that means one thing.'] },
      { h: 'A better way', p: ['Compare the PCR with its own past range (the PCR page shows a percentile) and watch how it changes around expiry, when old contracts roll off. This site reports the ratio and its history; it does not label it bullish or bearish.'] },
    ],
    tools: [{ href: '/options/pcr', label: 'Put-call ratio' }, { href: '/options/pe-ce', label: 'PE − CE difference' }],
  },
  {
    slug: 'max-pain', topic: 'Open interest', title: 'Max pain',
    summary: 'The strike at which option holders would collect the least at expiry, and how to test the idea.',
    sections: [
      { p: ['For each strike, add up what every open call and put would be worth if the underlying closed exactly there at expiry. Max pain is the strike where that total is smallest: the least paid out to option holders.'] },
      { h: 'The theory and the test', p: ['The idea is that prices tend to drift towards max pain near expiry. Rather than take that on trust, the max-pain page compares, for each past expiry, the max-pain strike a few sessions before with the actual expiry close, and counts how often they were close.'] },
      { h: 'Limits', p: ['Max pain uses open interest only, ignores what was paid for the options and moves as positions change during the week. Treat it as one description of where open interest sits.'] },
    ],
    tools: [{ href: '/options/max-pain', label: 'Max pain' }],
  },
  {
    slug: 'fii-dii-data', topic: 'Market data', title: 'FII and DII flows',
    summary: 'Where the numbers on foreign and domestic institutional investing come from.',
    sections: [
      { p: ['Foreign portfolio investors (FPIs, often called FIIs) and domestic institutions (DIIs: mutual funds, insurers and others) move a large share of Indian equity money. Their flows are reported in a few places.'] },
      { h: 'The sources', p: ['NSDL publishes FPI net investment in equity, debt and other assets from reported trades. Exchanges publish provisional daily buy and sell figures for FIIs and DIIs in the cash market. NSE also publishes participant-wise open interest and FII derivatives statistics for F&O.'] },
      { h: 'Reading them', p: ['Look at the trend over weeks rather than one day, and remember that cash-market and derivatives positions can offset each other. This site shows NSDL’s FPI flows and NSE’s F&O data.'] },
    ],
    tools: [{ href: '/research/fii', label: 'FII footprints' }],
  },
  {
    slug: 'sector-rotation', topic: 'Market data', title: 'Sector rotation charts',
    summary: 'Plotting each sector’s relative strength and its momentum against the index.',
    sections: [
      { p: ['A relative rotation chart places each sector index by two numbers: how strong it has been against a benchmark (RS-Ratio, across) and whether that strength is rising or falling (RS-Momentum, up). 100 on each axis is the benchmark’s own pace.'] },
      { h: 'The four quadrants', p: ['Leading (top right): stronger than the benchmark and gaining. Weakening (bottom right): still stronger, but losing pace. Lagging (bottom left): weaker and still losing. Improving (top left): weaker, but catching up.', 'Sectors often move clockwise through these quadrants, but not always, and they can jump or reverse.'] },
      { h: 'On this site', p: ['The original formulas are proprietary, so this site uses an open, smoothed method described on the page, from NSE’s official index closes. The tail shows the path over recent weeks.'] },
    ],
    tools: [{ href: '/market/rrg', label: 'Sector rotation' }, { href: '/market/breadth', label: 'Advance / decline' }],
  },
  {
    slug: 'india-vix', topic: 'Volatility', title: 'India VIX',
    summary: 'NSE’s volatility index: what it measures and what it does not.',
    sections: [
      { p: ['India VIX is computed by NSE from the bid and ask prices of NIFTY options. It expresses, as an annual percentage, the volatility the options market expects for the NIFTY over the next 30 days.'] },
      { h: 'Reading the number', p: ['A VIX of 15 roughly corresponds to an expected one-standard-deviation move of about 15% over a year, or about 15 ÷ √12 ≈ 4.3% over a month. It tends to rise when the market falls sharply and to drift lower in calm periods.'] },
      { h: 'What it is not', p: ['It is not a forecast of direction, and it measures option prices rather than actual moves. Compare it with the NIFTY’s historical volatility on the IV page to see whether options are priced above or below what the index has been doing.'] },
    ],
    tools: [{ href: '/options/iv?u=NIFTY', label: 'IV & HV' }, { href: '/chart/INDIAVIX', label: 'India VIX chart' }],
  },
  {
    slug: 'gamma-exposure', topic: 'Volatility', title: 'Gamma exposure',
    summary: 'A way to sum up where option hedging could add to or damp price moves, and its assumptions.',
    sections: [
      { p: ['Gamma measures how fast an option’s delta changes. Market makers who hedge their delta must buy or sell the underlying as the price moves, and gamma says how much. Gamma exposure (GEX) adds this up across open interest.'] },
      { h: 'The convention', p: ['GEX assumes market makers are long the calls the public sold and short the puts the public bought, so calls count positive and puts negative. Positive total GEX suggests hedging that leans against moves; negative suggests hedging that adds to them. The level where it changes sign is called the gamma flip.'] },
      { h: 'Caution', p: ['Who actually holds which side is not published, so GEX rests on that assumption. On this site it is a model estimate from end-of-day open interest and Black-76 gamma.'] },
    ],
    tools: [{ href: '/options/gex', label: 'Gamma exposure' }],
  },
  {
    slug: 'lot-size-and-margin', topic: 'Trading mechanics', title: 'Lot sizes and margin',
    summary: 'Contract size, SPAN margin and exposure margin, and why selling options needs much more money than buying.',
    sections: [
      { p: ['F&O contracts trade in lots: a fixed number of units of the underlying set by NSE and revised from time to time. Contract value is the price × lot size.'] },
      { h: 'Margin', p: ['A buyer of an option pays the premium in full. A seller, or anyone holding futures, must keep margin with the broker: SPAN margin, which NSE Clearing calculates from the worst loss across a set of price and volatility scenarios, plus an exposure margin set as a share of contract value.', 'Hedged positions need less, because SPAN looks at the whole portfolio: a sold option with a bought option further out has a much smaller worst case.'] },
      { h: 'On this site', p: ['The strategy builder calculates SPAN from NSE Clearing’s own risk parameter file and adds the exposure margin, showing the hedge benefit. Brokers may ask for more than this exchange minimum.'] },
    ],
    tools: [{ href: '/tools/lot-size', label: 'F&O lot sizes' }, { href: '/options', label: 'Strategy builder' }],
  },
  {
    slug: 'expiry-and-settlement', topic: 'Trading mechanics', title: 'Expiry and settlement',
    summary: 'What happens to futures and options on expiry day, for index and stock contracts.',
    sections: [
      { p: ['Every F&O contract has an expiry date. NSE sets which days these are and has changed them over the years; when an expiry falls on a holiday it moves to the previous trading day.'] },
      { h: 'Index contracts', p: ['Index options in India are European (exercised only at expiry) and cash-settled. Open options are settled at their intrinsic value against the index’s official closing value on expiry day; out-of-the-money options expire worthless.'] },
      { h: 'Stock contracts', p: ['Stock futures and options are settled by delivery of shares: an in-the-money option held to expiry turns into a buy or sell of the shares, which needs the money or shares to complete.'] },
      { h: 'Costs at expiry', p: ['Long in-the-money options held to expiry pay STT on their intrinsic value, and some brokers charge for exercise. Squaring off before expiry avoids both; the strategy builder shows the difference.'] },
    ],
    tools: [{ href: '/options', label: 'Strategy builder and simulator' }, { href: '/backtest/options', label: 'Options backtest' }],
  },
];

export const TOPICS: Article['topic'][] = ['Options basics', 'Open interest', 'Volatility', 'Market data', 'Trading mechanics'];
export const articleBySlug = (slug: string) => ARTICLES.find((a) => a.slug === slug);
