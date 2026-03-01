import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: [
    '@autonomy/shared',
    '@pyx-memory/dashboard',
    '@pyx-memory/client',
    '@pyx-memory/shared',
  ],
  turbopack: {
    root: '..',
  },
};

export default nextConfig;
