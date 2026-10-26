// Subscription plans. PRICES ARE PLACEHOLDERS: set them before launch. The live tier must cover NSE's per-user
// exchange fees (₹875/user/month each for cash and F&O L1 in a charting application, from 1 Apr 2026, excl. GST)
// plus the data vendor's charges and GST.

export type PlanId = 'FREE' | 'LIVE';
export type BillingInterval = 'month' | 'year';

export const PLANS: Record<PlanId, { name: string; tagline: string; pricePaise: Record<BillingInterval, number>; features: string[] }> = {
  FREE: {
    name: 'Free',
    tagline: 'Learn, research and practise',
    pricePaise: { month: 0, year: 0 },
    features: ['Charts with 15-minute delayed prices', 'All indicators and drawing tools', 'Stock & options backtesting on end-of-day data', 'Option chain (end of day)', 'Paper trading'],
  },
  LIVE: {
    name: 'Live',
    tagline: 'Real-time data for active traders',
    pricePaise: { month: 2999_00, year: 29990_00 }, // placeholder prices, GST inclusive
    features: ['Everything in Free', 'Real-time NSE prices, tick by tick', 'Live option chain with OI and Greeks', 'Live paper-trading fills', 'Priority support'],
  },
};

export const priceLabel = (paise: number) => (paise === 0 ? '₹0' : `₹${(paise / 100).toLocaleString('en-IN')}`);
