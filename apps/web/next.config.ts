import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@brawltome/ui'],
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
