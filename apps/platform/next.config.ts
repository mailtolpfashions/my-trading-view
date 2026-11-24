import type { NextConfig } from 'next';

// The platform (Screener, Strategies, Charts). Env comes from the repo-root .env via dotenv-cli. APP_MODE=public builds
// the website (no owner features, visitors signed in as anonymous); without it, the owner's app, which listens on
// 127.0.0.1 only because it has no accounts.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // personal (the owner's app) or public (the website): read by the browser code through src/lib/mode.ts
  env: { NEXT_PUBLIC_APP_MODE: process.env.APP_MODE ?? process.env.NEXT_PUBLIC_APP_MODE ?? 'personal' },
  transpilePackages: ['@mtv/shared', '@mtv/indicators', '@mtv/rules', '@mtv/backtest', '@mtv/options', '@mtv/paper'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
