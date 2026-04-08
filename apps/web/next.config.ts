import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@brawltome/ui', '@brawltome/shared'],
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: '../..',
  },
}

export default nextConfig
