import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Disclaimer' };

export default function Disclaimer() {
  return (
    <LegalPage title="Disclaimer" updated="26 October 2026">
      <p>
        My Trading View (&ldquo;we&rdquo;, &ldquo;the platform&rdquo;) provides charting, market data visualisation, research tools, backtesting and paper
        trading for the Indian securities markets.
      </p>
      <h2>Not investment advice</h2>
      <p>
        We are not registered with the Securities and Exchange Board of India (SEBI) as an investment adviser or research analyst. Nothing on the
        platform is a recommendation, solicitation or offer to buy or sell any security or derivative, and nothing is tailored to your financial situation.
      </p>
      <h2>Signals</h2>
      <p>
        Signals are generated automatically from published, rule-based strategies for research and education. Each signal shows its rules and its
        historical backtest. Backtests and past performance do not guarantee future results, and no level of accuracy or return is promised.
      </p>
      <h2>Market data</h2>
      <p>
        Data may be delayed, incomplete or inaccurate. Screens show when data is delayed. Always confirm prices with your broker before placing an order.
      </p>
      <h2>Your decisions</h2>
      <p>
        Trading in equities, futures and options involves substantial risk of loss. You are solely responsible for your trading decisions. Consult a
        SEBI-registered adviser before investing. Investments in securities are subject to market risks; read all related documents carefully before investing.
      </p>
    </LegalPage>
  );
}
