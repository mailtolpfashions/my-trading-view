import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Disclaimer' };

export default function Disclaimer() {
  return (
    <LegalPage title="Disclaimer" updated="1 November 2026">
      <p>
        My Trading View (&ldquo;we&rdquo;, &ldquo;the platform&rdquo;) provides research tools, backtesting and option strategy building on historical
        end-of-day data for the Indian securities markets. It does not provide live prices or place orders.
      </p>
      <h2>Not investment advice</h2>
      <p>
        We are not registered with the Securities and Exchange Board of India (SEBI) as an investment adviser or research analyst. Nothing on the
        platform is a recommendation, solicitation or offer to buy or sell any security or derivative, and nothing is tailored to your financial situation.
      </p>
      <h2>Backtests and models</h2>
      <p>
        Backtests, strategy payoffs, margin figures and what-if projections are calculations on historical data and models. Past results do not
        guarantee future results, model estimates can differ from actual market prices, and no level of accuracy or return is promised.
      </p>
      <h2>Market data</h2>
      <p>
        Prices are NSE&rsquo;s official end-of-day data, shown with their date; the platform has no live prices. Data may be incomplete or contain
        errors, which we report rather than hide. Always confirm prices with your broker before placing an order.
      </p>
      <h2>Your decisions</h2>
      <p>
        Trading in equities, futures and options involves substantial risk of loss. You are solely responsible for your trading decisions. Consult a
        SEBI-registered adviser before investing. Investments in securities are subject to market risks; read all related documents carefully before investing.
      </p>
    </LegalPage>
  );
}
