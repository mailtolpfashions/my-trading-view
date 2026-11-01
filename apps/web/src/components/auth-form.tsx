'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

/**
 * Sign-in: Google first (one click, and how most people will join), email + password below it for existing
 * accounts. Errors from the server are shown as they are.
 */
export function AuthForm({ mode, google }: { mode: 'login' | 'signup'; google: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get('next') ?? '';
  const next = /^\/(?![/\\])/.test(wanted) ? wanted : '/dashboard'; // same-site paths only ("//host" would leave the site)
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showEmail, setShowEmail] = useState(!google);

  async function withGoogle() {
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.social({ provider: 'google', callbackURL: next });
    if (res?.error) { setBusy(false); setError(res.error.message ?? 'Google sign-in failed. Please try again.'); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = mode === 'signup'
      ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
      : await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (res.error) return setError(res.error.message ?? 'Something went wrong. Please try again.');
    router.push(next);
    router.refresh();
  }

  const field = 'mt-1 h-11 w-full rounded-[12px] border border-line bg-panel px-3.5 text-[14.5px] outline-none focus:border-ink';
  return (
    <form onSubmit={submit} className="panel w-full max-w-[400px] space-y-4 p-7">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">{mode === 'signup' ? 'Create your free account' : 'Sign in'}</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">Everything is free. Signing in removes the daily limit on backtests, studies and scans.</p>
      </div>
      {google && (
        <button type="button" onClick={() => void withGoogle()} disabled={busy}
          className="flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-line bg-panel font-bold hover:bg-raised disabled:opacity-50">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </button>
      )}
      {google && !showEmail && (
        <button type="button" onClick={() => setShowEmail(true)} className="block w-full text-center text-[12.5px] font-semibold text-muted underline">Use email and password instead</button>
      )}
      {showEmail && <>
      {mode === 'signup' && (
        <label className="block text-[13px] font-semibold text-ink-2">Name
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
      )}
      <label className="block text-[13px] font-semibold text-ink-2">Email
        <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label className="block text-[13px] font-semibold text-ink-2">Password
        <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
      </label>
      {error && <p role="alert" className="rounded-[10px] bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">{error}</p>}
      <button type="submit" disabled={busy} className="h-11 w-full rounded-full bg-inverse font-bold text-on-inverse disabled:opacity-50">
        {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      </>}
      {error && !showEmail && <p role="alert" className="rounded-[10px] bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">{error}</p>}
      <p className="text-center text-[13px] text-ink-2">
        {mode === 'signup' ? <>Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-bold text-ink underline">Sign in</Link></>
          : <>New here? <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-bold text-ink underline">Create an account</Link></>}
      </p>
      {mode === 'signup' && <p className="text-center text-[11.5px] text-muted">By signing up you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy policy</Link>. Not investment advice.</p>}
    </form>
  );
}
