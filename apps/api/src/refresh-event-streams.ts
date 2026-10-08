import type { PlayerRefreshSettled } from '@brawltome/refresh-operations'
import type { Telemetry } from '@brawltome/telemetry'

/**
 * Server-sent events that tell a profile page its player refresh settled, so the page refetches at once instead of
 * polling. Every stream in the process shares one LISTEN (opened lazily on the first stream); streams are capped per
 * process and per client IP, short-lived (closed once the refresh settles, or after `maxStreamMs`), and ended when the
 * process announces shutdown so browsers reconnect to the replacement container.
 */
export type RefreshSettledSource = {
  listenPlayerRefreshSettled(
    onSettled: (event: PlayerRefreshSettled) => void,
    onListen?: () => void,
  ): Promise<{ unlisten: () => Promise<void> }>
}

export type RefreshEventStreamsOptions = {
  source: RefreshSettledSource
  telemetry: Pick<Telemetry, 'metrics' | 'logger'>
  maxStreams?: number
  maxStreamsPerClient?: number
  /** Comment lines that keep Cloudflare (100 s) and Traefik from treating the stream as idle. */
  keepAliveMs?: number
  /** Upper bound on one stream; the browser's EventSource reconnects on its own when it ends. */
  maxStreamMs?: number
  /** Reconnection delay the browser applies after the server ends a stream. */
  retryMs?: number
  /**
   * The LISTEN is released once no stream has been open this long. postgres.js re-LISTENs after a dropped connection
   * but gives up silently if that reconnect fails, so releasing when idle bounds how long a dead LISTEN can linger.
   */
  idleReleaseMs?: number
}

export type OpenRefreshEventStream = {
  brawlhallaId: number
  clientIp: string
  signal?: AbortSignal
}

type CloseReason = 'settled' | 'expired' | 'client' | 'draining'

type Stream = {
  brawlhallaId: number
  clientIp: string
  write: (chunk: string) => void
  close: (reason: CloseReason) => void
}

export const refreshEventStreamDefaults = {
  maxStreams: 2_000,
  maxStreamsPerClient: 8,
  keepAliveMs: 15_000,
  maxStreamMs: 55_000,
  retryMs: 2_000,
  idleReleaseMs: 30_000,
} as const

const encoder = new TextEncoder()

const streamHeaders = {
  'content-type': 'text/event-stream; charset=utf-8',
  // no-transform keeps Cloudflare from compressing (and so buffering) the stream.
  'cache-control': 'no-store, no-transform',
  'x-accel-buffering': 'no',
}

export function createRefreshEventStreams(options: RefreshEventStreamsOptions) {
  const maxStreams = options.maxStreams ?? refreshEventStreamDefaults.maxStreams
  const maxStreamsPerClient = options.maxStreamsPerClient ?? refreshEventStreamDefaults.maxStreamsPerClient
  const keepAliveMs = options.keepAliveMs ?? refreshEventStreamDefaults.keepAliveMs
  const maxStreamMs = options.maxStreamMs ?? refreshEventStreamDefaults.maxStreamMs
  const retryMs = options.retryMs ?? refreshEventStreamDefaults.retryMs
  const idleReleaseMs = options.idleReleaseMs ?? refreshEventStreamDefaults.idleReleaseMs
  const { metrics, logger } = options.telemetry

  const streamsByPlayer = new Map<number, Set<Stream>>()
  const streamsByClient = new Map<string, number>()
  let openStreams = 0
  let draining = false
  let listening: Promise<{ unlisten: () => Promise<void> }> | undefined
  let idleRelease: ReturnType<typeof setTimeout> | undefined

  function deliver(stream: Stream, event: 'settled' | 'resync', data: Record<string, unknown>) {
    stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  function onSettled(event: PlayerRefreshSettled) {
    const streams = streamsByPlayer.get(event.brawlhallaId)
    if (!streams) return
    for (const stream of [...streams]) {
      deliver(stream, 'settled', { status: event.status, operationId: event.operationId })
      metrics.add('refresh_events_delivered_total', 1, { event: event.status })
      stream.close('settled')
    }
  }

  // After a LISTEN reconnect, settlements sent while the connection was down are lost: every open page refetches.
  function onReconnected() {
    logger.warn('refresh_events.listen.reconnected', { streams: openStreams })
    for (const streams of streamsByPlayer.values()) {
      for (const stream of streams) {
        deliver(stream, 'resync', {})
        metrics.add('refresh_events_delivered_total', 1, { event: 'resync' })
      }
    }
  }

  function ensureListening() {
    clearTimeout(idleRelease)
    idleRelease = undefined
    if (!listening) {
      let established = false
      const current = options.source.listenPlayerRefreshSettled(onSettled, () => {
        if (established) onReconnected()
        established = true
      })
      listening = current
      current.catch((error) => {
        if (listening === current) listening = undefined
        logger.error('refresh_events.listen.failed', error)
      })
    }
    return listening
  }

  async function releaseListener() {
    clearTimeout(idleRelease)
    idleRelease = undefined
    const current = listening
    listening = undefined
    if (!current) return
    try {
      await (await current).unlisten()
    } catch {
      // A LISTEN that failed has nothing to release.
    }
  }

  function releaseWhenIdle() {
    if (openStreams > 0 || !listening || idleRelease) return
    idleRelease = setTimeout(() => {
      idleRelease = undefined
      if (openStreams === 0) void releaseListener()
    }, idleReleaseMs)
    idleRelease.unref?.()
  }

  function reconnectLater(): Response {
    metrics.add('refresh_event_streams_total', 1, { outcome: 'draining' })
    return new Response(`retry: ${retryMs}\n\n`, { status: 200, headers: streamHeaders })
  }

  async function open(input: OpenRefreshEventStream): Promise<Response> {
    if (draining) return reconnectLater()
    if (openStreams >= maxStreams) {
      metrics.add('refresh_event_streams_total', 1, { outcome: 'rejected_capacity' })
      return Response.json({ error: 'too_many_event_streams' }, { status: 429, headers: { 'retry-after': '30' } })
    }
    if ((streamsByClient.get(input.clientIp) ?? 0) >= maxStreamsPerClient) {
      metrics.add('refresh_event_streams_total', 1, { outcome: 'rejected_client' })
      return Response.json({ error: 'too_many_event_streams' }, { status: 429, headers: { 'retry-after': '30' } })
    }
    try {
      await ensureListening()
    } catch {
      metrics.add('refresh_event_streams_total', 1, { outcome: 'unavailable' })
      return Response.json({ error: 'refresh_events_unavailable' }, { status: 503, headers: { 'retry-after': '5' } })
    }
    // Shutdown may have been announced or capacity taken while LISTEN was being established.
    if (draining) return reconnectLater()
    if (openStreams >= maxStreams || (streamsByClient.get(input.clientIp) ?? 0) >= maxStreamsPerClient) {
      metrics.add('refresh_event_streams_total', 1, { outcome: 'rejected_capacity' })
      return Response.json({ error: 'too_many_event_streams' }, { status: 429, headers: { 'retry-after': '30' } })
    }
    if (input.signal?.aborted) {
      return new Response(null, { status: 204 })
    }

    let controller!: ReadableStreamDefaultController<Uint8Array>
    let closed = false
    const timers: { keepAlive?: ReturnType<typeof setInterval>; expiry?: ReturnType<typeof setTimeout> } = {}

    const stream: Stream = {
      brawlhallaId: input.brawlhallaId,
      clientIp: input.clientIp,
      write(chunk) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          stream.close('client')
        }
      },
      close(reason) {
        if (closed) return
        closed = true
        clearInterval(timers.keepAlive)
        clearTimeout(timers.expiry)
        input.signal?.removeEventListener('abort', onAbort)
        const players = streamsByPlayer.get(stream.brawlhallaId)
        players?.delete(stream)
        if (players?.size === 0) streamsByPlayer.delete(stream.brawlhallaId)
        const remaining = (streamsByClient.get(stream.clientIp) ?? 1) - 1
        if (remaining > 0) streamsByClient.set(stream.clientIp, remaining)
        else streamsByClient.delete(stream.clientIp)
        openStreams--
        metrics.add('refresh_event_streams_closed_total', 1, { reason })
        releaseWhenIdle()
        if (reason !== 'client') {
          try {
            controller.close()
          } catch {
            // Already closed by the client.
          }
        }
      },
    }
    const onAbort = () => stream.close('client')

    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController
      },
      cancel() {
        stream.close('client')
      },
    })

    openStreams++
    streamsByClient.set(input.clientIp, (streamsByClient.get(input.clientIp) ?? 0) + 1)
    const players = streamsByPlayer.get(input.brawlhallaId) ?? new Set<Stream>()
    players.add(stream)
    streamsByPlayer.set(input.brawlhallaId, players)
    metrics.add('refresh_event_streams_total', 1, { outcome: 'opened' })

    input.signal?.addEventListener('abort', onAbort, { once: true })
    timers.keepAlive = setInterval(() => stream.write(': keep-alive\n\n'), keepAliveMs)
    timers.expiry = setTimeout(() => stream.close('expired'), maxStreamMs)

    // `ready` tells the page the subscription is live: it refetches once, so a refresh that settled before the
    // stream opened is not missed.
    stream.write(`retry: ${retryMs}\nevent: ready\ndata: {}\n\n`)
    return new Response(body, { status: 200, headers: streamHeaders })
  }

  /** Ends every open stream and answers new ones with a reconnect hint; called when shutdown is announced. */
  function drain() {
    draining = true
    for (const streams of [...streamsByPlayer.values()]) {
      for (const stream of [...streams]) stream.close('draining')
    }
  }

  async function close() {
    drain()
    await releaseListener()
  }

  return {
    open,
    drain,
    close,
    get openStreams() {
      return openStreams
    },
  }
}

export type RefreshEventStreams = ReturnType<typeof createRefreshEventStreams>
