'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

/** Sign-up and sign-in form (email + password). Errors from the server are shown as they are. */
export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get('next') ?? '';
  const next = /^\/(?![/\\])/.test(wanted) ? wanted : '/terminal'; // same-site paths only ("//host" would leave the site)
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <h1 className="text-[24px] font-extrabold tracking-[-0.03em]">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">{mode === 'signup' ? 'Free plan: delayed charts, backtesting and paper trading.' : 'Sign in to open your terminal.'}</p>
      </div>
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
      <button type="submit" disabled={busy} className="h-11 w-full rounded-full bg-ink font-bold text-white disabled:opacity-50">
        {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      <p className="text-center text-[13px] text-ink-2">
        {mode === 'signup' ? <>Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-bold text-ink underline">Sign in</Link></>
          : <>New here? <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-bold text-ink underline">Create an account</Link></>}
      </p>
      {mode === 'signup' && <p className="text-center text-[11.5px] text-muted">By signing up you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy policy</Link>. Not investment advice.</p>}
    </form>
  );
}
