// Kite Connect login and session. The access token expires at 6 AM IST the next day (Zerodha/SEBI rule), so the user
// logs in once a day. The token is kept only on this machine, in apps/feed/.cache (git-ignored).

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FILE = path.resolve(import.meta.dirname, '../../../.cache/kite-session.json');
const IST = 5.5 * 3600;

export type KiteSession = { accessToken: string; userId: string; userName: string; loginTime: number; expiresAt: number };

export const kiteApiKey = () => process.env.KITE_API_KEY ?? '';
const kiteSecret = () => process.env.KITE_API_SECRET ?? '';
export const kiteConfigured = () => /^[a-z0-9]{8,}$/i.test(kiteApiKey()) && /^[a-z0-9]{16,}$/i.test(kiteSecret());

export const loginUrl = () => `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(kiteApiKey())}`;

/** 06:00 IST on the day after `loginSec` (or the same day if the login happened before 06:00 IST). */
export function sessionExpiry(loginSec: number): number {
  const local = loginSec + IST;
  const sixAm = local - (local % 86400) + 6 * 3600;
  return (local < sixAm ? sixAm : sixAm + 86400) - IST;
}

export const checksum = (apiKey: string, requestToken: string, secret: string) => createHash('sha256').update(apiKey + requestToken + secret).digest('hex');

let current: KiteSession | null = null;

export async function loadSession(): Promise<KiteSession | null> {
  try {
    current = JSON.parse(await readFile(FILE, 'utf8')) as KiteSession;
  } catch {
    current = null;
  }
  return activeSession();
}

/** The session if it is still valid; null once it has expired. */
export function activeSession(): KiteSession | null {
  return current && Date.now() / 1000 < current.expiresAt ? current : null;
}

/** Exchanges the one-time request_token from the login redirect for an access token. */
export async function createSession(requestToken: string): Promise<KiteSession> {
  const body = new URLSearchParams({ api_key: kiteApiKey(), request_token: requestToken, checksum: checksum(kiteApiKey(), requestToken, kiteSecret()) });
  const res = await fetch('https://api.kite.trade/session/token', { method: 'POST', headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
  const json = (await res.json()) as { status: string; message?: string; data?: { access_token: string; user_id: string; user_name: string } };
  if (!res.ok || json.status !== 'success' || !json.data) throw new Error(json.message ?? `Kite login failed (HTTP ${res.status})`);
  const now = Math.floor(Date.now() / 1000);
  current = { accessToken: json.data.access_token, userId: json.data.user_id, userName: json.data.user_name, loginTime: now, expiresAt: sessionExpiry(now) };
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(current));
  return current;
}

/** Forget the session (after Kite reports it invalid, or on logout). */
export async function clearSession() {
  current = null;
  await rm(FILE, { force: true });
}

export const authHeader = (s: KiteSession) => ({ 'X-Kite-Version': '3', Authorization: `token ${kiteApiKey()}:${s.accessToken}` });
