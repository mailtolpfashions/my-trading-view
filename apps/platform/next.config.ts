import type { NextConfig } from 'next';

// The personal platform (Screener, Strategies, Charts). Env comes from the repo-root .env via dotenv-cli. It runs on
// 127.0.0.1 only: there are no accounts, so it must not be reachable from the network until it has a sign-in.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@mtv/shared', '@mtv/indicators', '@mtv/rules'],
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
