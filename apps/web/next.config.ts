import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@brawltome/ui'],
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: '../..',
  },
}

export default nextConfig
