import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: isProduction ? '/encyclicals' : undefined,
  assetPrefix: isProduction ? '/encyclicals' : undefined,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
