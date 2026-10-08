import { describe, expect, test } from 'bun:test'
import { type RefreshEventSource, createRefreshEventPush, playerRefreshEventsUrl } from '../../src/lib/refresh-events'
import { type RefreshRunClock, type StaleRefreshSettlement, startRefreshRun } from '../../src/lib/refresh-run'

function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  const clock: RefreshRunClock & { advance: (ms: number) => Promise<void>; pending: () => number[] } = {
    now: () => now,
    setTimeout: (callback, ms) => {
      const id = nextId++
      timers.set(id, { at: now + ms, callback })
      return id
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number)
    },
    async advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].callback()
        await flush()
      }
      now = target
    },
    pending: () => [...timers.values()].map(({ at }) => at - now),
  }
  return clock
}

async function flush() {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setImmediate(resolve))
}

class FakeEventSource implements RefreshEventSource {
  static instances: FakeEventSource[] = []
  readyState = 0
  closed = false
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>()
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  emit(type: string, data = '{}') {
    if (type !== 'error') this.readyState = 1
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent<string>)
  }
}

type Profile = { version: number }

function setup(options: { eventSource?: boolean; doneAt?: number } = {}) {
  FakeEventSource.instances = []
  const clock = fakeClock()
  let version = 0
  let queries = 0
  const settlements: StaleRefreshSettlement[] = []
  const push = createRefreshEventPush(
    playerRefreshEventsUrl('https://api.brawltome.app', 42),
    options.eventSource === false ? undefined : (url) => new FakeEventSource(url),
  )
  const stop = startRefreshRun<Profile>({
    initial: { version: 0 },
    queryFn: async () => {
      queries++
      return { version }
    },
    isDone: (_previous, next) => next.version >= (options.doneAt ?? 1),
    pollMs: 5_000,
    pushedPollMs: 15_000,
    maxRefreshMs: 90_000,
    push,
    onData: () => {},
    onSettled: (settlement) => settlements.push(settlement),
    clock,
  })
  return {
    clock,
    stop,
    settlements,
    get queries() {
      return queries
    },
    complete: () => {
      version++
    },
    get source() {
      const source = FakeEventSource.instances[0]
      if (!source) throw new Error('Expected an EventSource')
      return source
    },
  }
}

describe('player refresh completion push', () => {
  test('subscribes to the player stream on the public API', () => {
    const run = setup()
    expect(run.source.url).toBe('https://api.brawltome.app/events/player/42/refresh')
    run.stop()
  })

  test('refetches as soon as the refresh settles and closes the stream when the data is fresh', async () => {
    const run = setup()
    run.source.emit('ready')
    await flush()
    // The ready refetch catches a refresh that settled before the subscription opened.
    expect(run.queries).toBe(1)
    expect(run.settlements).toEqual([])

    await run.clock.advance(1_200)
    expect(run.queries).toBe(1)
    run.complete()
    run.source.emit('settled', '{"status":"succeeded","operationId":"op-1"}')
    await flush()
    expect(run.queries).toBe(2)
    expect(run.settlements).toEqual(['done'])
    expect(run.source.closed).toBe(true)
    expect(run.clock.pending()).toEqual([])
  })

  test('slows polling to a safety net while the stream is live', async () => {
    const run = setup()
    run.source.emit('ready')
    await flush()
    expect(run.queries).toBe(1)
    await run.clock.advance(14_999)
    expect(run.queries).toBe(1)
    await run.clock.advance(1)
    expect(run.queries).toBe(2)
    run.stop()
  })

  test('falls back to five-second polling when the EventSource fails for good', async () => {
    const run = setup()
    run.source.readyState = 2
    run.source.emit('error')
    expect(run.source.closed).toBe(true)
    await run.clock.advance(5_000)
    expect(run.queries).toBe(1)
    await run.clock.advance(5_000)
    expect(run.queries).toBe(2)
    run.complete()
    await run.clock.advance(5_000)
    expect(run.settlements).toEqual(['done'])
  })

  test('falls back to polling after a live stream keeps failing to reconnect', async () => {
    const run = setup()
    run.source.emit('ready')
    await flush()
    expect(run.queries).toBe(1)
    for (let attempt = 0; attempt < 4; attempt++) run.source.emit('error')
    expect(run.source.closed).toBe(false)
    run.source.emit('error')
    expect(run.source.closed).toBe(true)
    await run.clock.advance(5_000)
    expect(run.queries).toBe(2)
    run.stop()
  })

  test('stays subscribed across a server-ended stream that reconnects', async () => {
    const run = setup()
    run.source.emit('ready')
    await flush()
    run.source.emit('error')
    run.source.emit('ready')
    await flush()
    expect(run.source.closed).toBe(false)
    expect(run.queries).toBe(2)
    await run.clock.advance(5_000)
    expect(run.queries).toBe(2)
    run.stop()
  })

  test('polls every five seconds without EventSource support', async () => {
    const run = setup({ eventSource: false })
    expect(FakeEventSource.instances).toHaveLength(0)
    await run.clock.advance(5_000)
    expect(run.queries).toBe(1)
    await run.clock.advance(5_000)
    expect(run.queries).toBe(2)
    run.stop()
  })

  test('refetches on a dead-lettered refresh, then stops listening and keeps polling', async () => {
    const run = setup()
    run.source.emit('ready')
    await flush()
    run.source.emit('settled', '{"status":"dead_letter","operationId":"op-2"}')
    await flush()
    expect(run.queries).toBe(2)
    expect(run.source.closed).toBe(true)
    await run.clock.advance(5_000)
    expect(run.queries).toBe(3)
    run.stop()
  })

  test('refetches after a resync, when settlements may have been missed', async () => {
    const run = setup()
    run.source.emit('ready')
    await flush()
    run.source.emit('resync')
    await flush()
    expect(run.queries).toBe(2)
    run.stop()
  })

  test('queues one refetch when the stream fires during an in-flight request', async () => {
    FakeEventSource.instances = []
    const clock = fakeClock()
    const resolvers: ((value: Profile) => void)[] = []
    const push = createRefreshEventPush('https://api/events/player/1/refresh', (url) => new FakeEventSource(url))
    const stop = startRefreshRun<Profile>({
      initial: { version: 0 },
      queryFn: () => new Promise<Profile>((resolve) => resolvers.push(resolve)),
      isDone: () => false,
      pollMs: 5_000,
      pushedPollMs: 15_000,
      maxRefreshMs: 90_000,
      push,
      onData: () => {},
      onSettled: () => {},
      clock,
    })
    const source = FakeEventSource.instances[0]
    source.emit('ready')
    source.emit('settled', '{"status":"succeeded","operationId":"op"}')
    source.emit('resync')
    expect(resolvers).toHaveLength(1)
    resolvers[0]({ version: 0 })
    await flush()
    expect(resolvers).toHaveLength(2)
    resolvers[1]({ version: 0 })
    await flush()
    expect(resolvers).toHaveLength(2)
    stop()
  })

  test('closes the stream and stops polling when the page unmounts', async () => {
    const run = setup()
    run.source.emit('ready')
    await flush()
    run.stop()
    expect(run.source.closed).toBe(true)
    expect(run.clock.pending()).toEqual([])
    run.source.emit('settled', '{"status":"succeeded","operationId":"op-3"}')
    await run.clock.advance(60_000)
    expect(run.queries).toBe(1)
    expect(run.settlements).toEqual([])
  })

  test('gives up at the deadline like polling did', async () => {
    const run = setup()
    run.source.emit('ready')
    await flush()
    // The deadline is checked on the next poll after 90 s, as before.
    await run.clock.advance(105_000)
    expect(run.settlements).toEqual(['timeout'])
    expect(run.source.closed).toBe(true)
  })
})
