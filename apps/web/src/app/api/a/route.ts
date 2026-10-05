import { randomBytes } from 'node:crypto'
import { readBoundedText } from '@/lib/analytics/body'
import { ingestBatch } from '@/lib/analytics/ingest'
import { createTabRateLimiter } from '@/lib/analytics/rate-limit'
import { createDailySalt } from '@/lib/analytics/salt'
import { webTelemetry } from '@/lib/web-telemetry-registry'

const salt = createDailySalt(Date.now, (bytes) => new Uint8Array(randomBytes(bytes)))
const limiter = createTabRateLimiter(30, Date.now)

// The address is only ever hashed into a daily visitor key, never stored. Route handlers have no peer address, so a
// spoofed header can only skew approximate unique counts.
function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    ''
  )
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown = null
  try {
    const text = await readBoundedText(request)
    if (text === null) {
      webTelemetry.metrics.add('analytics_events_dropped_total', 1, { reason: 'invalid' })
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
    }
    body = JSON.parse(text)
  } catch {
    body = null
  }
  ingestBatch(
    { body, ip: clientIp(request), userAgent: request.headers.get('user-agent') ?? '' },
    { telemetry: webTelemetry, salt, limiter },
  )
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}
