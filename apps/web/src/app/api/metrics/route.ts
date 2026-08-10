import { timingSafeEqual } from 'node:crypto'
import { webTelemetry } from '@/lib/web-telemetry-registry'
import { renderPrometheus } from '@brawltome/telemetry'

function authorized(provided: string | null): boolean {
  const expected = process.env.INTERNAL_API_SECRET
  if (!provided || !expected || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get('x-internal-secret'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return new Response(renderPrometheus(webTelemetry.metrics.snapshot()), {
    headers: {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
