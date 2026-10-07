import { Hono } from 'hono'
import type { RuntimeLifecycle } from './runtime-lifecycle'

export function createHealthRoutes(lifecycle: RuntimeLifecycle) {
  const health = new Hono()

  health.get('/live', (context) => context.json({ status: 'live' as const }))
  // Load balancer membership: unlike /ready it ignores dependencies, so a database blip cannot drain every instance.
  health.get('/serving', (context) =>
    lifecycle.serving()
      ? context.json({ status: 'serving' as const })
      : context.json({ status: 'draining' as const }, 503),
  )
  health.get('/ready', async (context) => {
    const result = await lifecycle.readiness()
    if (result.ready) return context.json({ status: 'ready' as const })
    return context.json(
      {
        status: 'unready' as const,
        reason: result.reason,
        ...(result.dependency ? { dependency: result.dependency } : {}),
      },
      503,
    )
  })

  return health
}
