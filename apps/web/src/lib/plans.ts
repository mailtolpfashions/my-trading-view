// Subscription plans. PRICES ARE PLACEHOLDERS: set them before launch. The site shows NSE end-of-day data only (no
// live prices); the paid plan's id stays 'LIVE' in the database and billing code, displayed as "Pro".

export type PlanId = 'FREE' | 'LIVE';
export type BillingInterval = 'month' | 'year';

export const PLANS: Record<PlanId, { name: string; tagline: string; pricePaise: Record<BillingInterval, number>; features: string[] }> = {
  FREE: {
    name: 'Free',
    tagline: 'Learn, research and practise',
    pricePaise: { month: 0, year: 0 },
    features: ['Charts on NSE end-of-day data', 'All indicators and drawing tools', 'Stock & options backtesting', 'Option chain and strategy builder (end of day)', 'NIFTY research tables'],
  },
  LIVE: {
    name: 'Pro',
    tagline: 'For deeper research',
    pricePaise: { month: 2999_00, year: 29990_00 }, // placeholder prices, GST inclusive
    features: ['Everything in Free', 'Higher backtest and scanner limits (being finalised)', 'Practice mode (bar replay), when it launches', 'Priority support'],
  },
};

export const priceLabel = (paise: number) => (paise === 0 ? '₹0' : `₹${(paise / 100).toLocaleString('en-IN')}`);
