import { Hono } from 'hono'
import type { RefreshEventStreams } from '../refresh-event-streams'

const brawlhallaIdPattern = /^[1-9][0-9]{0,15}$/

export function createRefreshEventRoutes(streams: Pick<RefreshEventStreams, 'open'>): Hono {
  const routes = new Hono()

  routes.get('/player/:brawlhallaId/refresh', (context) => {
    const raw = context.req.param('brawlhallaId')
    const brawlhallaId = Number(raw)
    if (!brawlhallaIdPattern.test(raw) || !Number.isSafeInteger(brawlhallaId)) {
      return context.json({ error: 'invalid_brawlhalla_id' }, 400)
    }
    return streams.open({
      brawlhallaId,
      clientIp: context.req.header('x-client-ip') ?? '0.0.0.0',
      signal: context.req.raw.signal,
    })
  })

  return routes
}
