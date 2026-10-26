import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Terms of use' };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'support@mytradingview.in';

export default function Terms() {
  return (
    <LegalPage title="Terms of use" updated="26 October 2026">
      <p>By using mytradingview.in you agree to these terms. If you do not agree, please do not use the platform.</p>
      <h2>The service</h2>
      <p>
        My Trading View is a software tool for charting, research, backtesting and paper trading. It is in beta: features may change, and the service
        may be interrupted or unavailable at times.
      </p>
      <h2>No advice</h2>
      <p>The platform does not provide investment advice. Please read our Disclaimer, which forms part of these terms.</p>
      <h2>Your account</h2>
      <ul>
        <li>Keep your login details safe. You are responsible for activity under your account.</li>
        <li>Broker connections use your broker&rsquo;s official login. Orders placed through a connected broker are your instructions to that broker.</li>
        <li>Paper trading uses virtual funds only and does not reflect real fills, slippage or charges exactly.</li>
      </ul>
      <h2>Acceptable use</h2>
      <ul>
        <li>Do not scrape, resell or redistribute market data or content from the platform.</li>
        <li>Do not attempt to disrupt, reverse engineer or gain unauthorised access to the service.</li>
        <li>Do not use the platform to publish paid tips or to misrepresent signals as personal advice.</li>
      </ul>
      <h2>Liability</h2>
      <p>
        The platform is provided &ldquo;as is&rdquo;. To the extent permitted by law, we are not liable for trading losses or for losses caused by
        delayed, inaccurate or unavailable data or service.
      </p>
      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India.</p>
      <h2>Contact</h2>
      <p>Questions about these terms: {CONTACT}</p>
    </LegalPage>
  );
}
