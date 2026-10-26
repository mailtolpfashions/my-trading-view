import 'server-only';

/** Site owners: the emails in ADMIN_EMAILS (comma-separated). */
export const isAdmin = (email: string) =>
  (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
