import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = { title: 'Privacy policy' };

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'support@mytradingview.in';

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="26 October 2026">
      <p>This policy explains what personal data My Trading View collects and how we use it, in line with India&rsquo;s Digital Personal Data Protection Act, 2023.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Account details you give us: name, email address and mobile number.</li>
        <li>Your settings and content: watchlists, chart layouts, alerts, strategies and paper trades.</li>
        <li>Broker connection tokens, if you connect a broker. We never see or store your broker password.</li>
        <li>Basic technical data such as device, browser and log information, used to run and secure the service.</li>
      </ul>
      <h2>How we use it</h2>
      <p>To provide the service, keep it secure, answer support requests and tell you about important changes. We do not sell your personal data.</p>
      <h2>Sharing</h2>
      <p>
        Only with service providers who host or operate the platform for us, with your broker when you ask us to place an order, or when the law requires it.
      </p>
      <h2>Retention and your rights</h2>
      <p>
        We keep data while your account is active and as required by law. You can ask to access, correct or erase your personal data, or withdraw consent,
        by writing to {CONTACT}.
      </p>
    </LegalPage>
  );
}
