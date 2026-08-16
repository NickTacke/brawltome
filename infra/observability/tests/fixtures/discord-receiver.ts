const events: unknown[] = []

Bun.serve({
  port: 8080,
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/api/webhooks/local') {
      events.push(await request.json())
      return new Response(null, { status: 204 })
    }
    if (request.method === 'GET' && url.pathname === '/events') return Response.json(events)
    if (request.method === 'DELETE' && url.pathname === '/events') {
      events.length = 0
      return new Response(null, { status: 204 })
    }
    if (request.method === 'GET' && url.pathname === '/health') return new Response('ok')
    return new Response('not found', { status: 404 })
  },
})
