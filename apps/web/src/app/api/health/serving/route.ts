import { isDraining } from '@/lib/shutdown-drain'

export const dynamic = 'force-dynamic'

// Load balancer membership: unlike /api/health/ready it ignores the API, so an API blip cannot drain every web instance.
export function GET(): Response {
  const draining = isDraining()
  return Response.json(
    { status: draining ? 'draining' : 'serving' },
    { status: draining ? 503 : 200, headers: { 'cache-control': 'no-store' } },
  )
}
