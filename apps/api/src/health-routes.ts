import { Hono } from 'hono'
import type { RuntimeLifecycle } from './runtime-lifecycle'

export function createHealthRoutes(lifecycle: RuntimeLifecycle) {
  const health = new Hono()

  health.get('/live', (context) => context.json({ status: 'live' as const }))
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
