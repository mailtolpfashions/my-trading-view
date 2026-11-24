import { notFound } from 'next/navigation';

// Target of the public site's rewrite for owner-only pages (middleware.ts): always the 404 page, with a 404 status.
export default function NotAvailable() {
  notFound();
}
