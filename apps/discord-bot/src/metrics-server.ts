import { timingSafeEqual } from 'node:crypto'
import { type Telemetry, renderPrometheus } from '@brawltome/telemetry'

function authorized(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export function startDiscordMetricsServer(options: {
  telemetry: Telemetry
  port: number
  secret: string | undefined
  serve?: typeof Bun.serve
}): ReturnType<typeof Bun.serve> | undefined {
  try {
    return (options.serve ?? Bun.serve)({
      port: options.port,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname !== '/metrics') return new Response('not found', { status: 404 })
        if (!authorized(request.headers.get('x-internal-secret'), options.secret)) {
          return Response.json({ error: 'unauthorized' }, { status: 401 })
        }
        return new Response(renderPrometheus(options.telemetry.metrics.snapshot()), {
          headers: {
            'content-type': 'text/plain; version=0.0.4; charset=utf-8',
            'cache-control': 'no-store',
          },
        })
      },
    })
  } catch (error) {
    options.telemetry.logger.error('discord.metrics.startup_failed', error)
    return undefined
  }
}
