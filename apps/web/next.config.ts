import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repositoryRoot,
  transpilePackages: ['@brawltome/ui', '@brawltome/shared', '@brawltome/telemetry'],
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: '../..',
  },
}

export default nextConfig
