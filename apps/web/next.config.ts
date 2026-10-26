import type { NextConfig } from 'next';

// Env comes from the repo-root .env via dotenv-cli in package.json scripts.
const nextConfig: NextConfig = {
  transpilePackages: ['@mtv/shared', '@mtv/indicators', '@mtv/paper', '@mtv/backtest', '@mtv/options'],
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
