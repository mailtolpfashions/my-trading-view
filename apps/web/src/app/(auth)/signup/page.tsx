import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
import { googleLoginEnabled } from '@/lib/auth';

export const metadata: Metadata = { title: 'Create account' };
// Rendered per request, so the Google button follows .env without a rebuild.
export const dynamic = 'force-dynamic';

export default function SignupPage() {
  return <Suspense><AuthForm mode="signup" google={googleLoginEnabled()} /></Suspense>;
}
