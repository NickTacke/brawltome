// Fake Discord webhook API for the synthetic alerting test: records every request, assigns message ids for
// ?wait=true posts, supports editing messages in place, and can answer the next request with a 429.
type RecordedRequest = { method: string; path: string; query: string; body: unknown; status?: number }

const events: RecordedRequest[] = []
const messages = new Map<string, unknown>()
let nextId = 1
let rateLimitNext = 0
const base = '/api/webhooks/local'

Bun.serve({
  port: 8080,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith(base) && (request.method === 'POST' || request.method === 'PATCH')) {
      const body = await request.json()
      const event: RecordedRequest = { method: request.method, path: url.pathname, query: url.search, body }
      events.push(event)
      if (rateLimitNext > 0) {
        rateLimitNext--
        event.status = 429
        return Response.json(
          { message: 'You are being rate limited.', retry_after: 0.5, global: false },
          { status: 429 },
        )
      }
      if (request.method === 'POST' && url.pathname === base) {
        const id = String(nextId++)
        messages.set(id, body)
        return url.searchParams.get('wait') === 'true' ? Response.json({ id }) : new Response(null, { status: 204 })
      }
      const edit = url.pathname.match(/^\/api\/webhooks\/local\/messages\/(\d+)$/)
      if (request.method === 'PATCH' && edit?.[1] && messages.has(edit[1])) {
        messages.set(edit[1], body)
        return Response.json({ id: edit[1] })
      }
      return Response.json({ message: 'Unknown Message' }, { status: 404 })
    }
    if (request.method === 'GET' && url.pathname === '/events') return Response.json(events)
    if (request.method === 'GET' && url.pathname === '/messages') return Response.json(Object.fromEntries(messages))
    if (request.method === 'POST' && url.pathname === '/rate-limit-next') {
      rateLimitNext = Number(url.searchParams.get('count') ?? 1)
      return new Response(null, { status: 204 })
    }
    if (request.method === 'DELETE' && url.pathname === '/events') {
      events.length = 0
      return new Response(null, { status: 204 })
    }
    if (request.method === 'GET' && url.pathname === '/health') return new Response('ok')
    return new Response('not found', { status: 404 })
  },
})
