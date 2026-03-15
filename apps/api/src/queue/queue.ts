import type { Redis } from 'ioredis'

export interface QueueOptions {
  concurrency?: number
  retries?: number
  backoffMs?: number
}

export interface Queue<T> {
  enqueue(data: T): Promise<boolean>
  start(): Promise<void>
  stop(): void
  depth(): Promise<number>
}

export function createQueue<T>(
  redis: Redis,
  name: string,
  handler: (data: T) => Promise<void>,
  opts: QueueOptions = {},
): Queue<T> {
  const { concurrency = 5, retries = 3, backoffMs = 1000 } = opts
  const stream = `queue:${name}`
  const group = `${name}-workers`
  const consumer = `${name}-${crypto.randomUUID().slice(0, 8)}`
  let running = 0
  let stopped = false

  async function init() {
    try {
      await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('BUSYGROUP')) throw err
    }
  }

  async function enqueue(data: T): Promise<boolean> {
    await redis.xadd(stream, '*', 'data', JSON.stringify(data))
    return true
  }

  async function depth(): Promise<number> {
    const info = await redis.xinfo('GROUPS', stream)
    if (!Array.isArray(info) || info.length === 0) return 0

    // xinfo returns flat arrays: ['name', 'group', 'consumers', N, 'pending', N, 'lag', N, ...]
    const groupInfo = info[0] as string[]
    const lagIndex = groupInfo.indexOf('lag')
    if (lagIndex !== -1 && lagIndex + 1 < groupInfo.length) {
      return Number(groupInfo[lagIndex + 1])
    }

    const pendingIndex = groupInfo.indexOf('pending')
    if (pendingIndex !== -1 && pendingIndex + 1 < groupInfo.length) {
      return Number(groupInfo[pendingIndex + 1])
    }

    return 0
  }

  async function start() {
    if (concurrency === 0) return
    await init()
    await claimPending()

    while (!stopped) {
      if (running >= concurrency) {
        await Bun.sleep(50)
        continue
      }

      try {
        const messages = await redis.xreadgroup(
          'GROUP',
          group,
          consumer,
          'COUNT',
          String(concurrency - running),
          'BLOCK',
          '2000',
          'STREAMS',
          stream,
          '>',
        )

        if (!messages || stopped) continue

        for (const [, entries] of messages as [string, [string, string[]][]][]) {
          for (const [id, fields] of entries) {
            running++
            processJob(id, JSON.parse(fields[1]) as T, retries).finally(() => {
              running--
            })
          }
        }
      } catch (err) {
        if (!stopped) {
          console.error(`[queue:${name}] read error:`, err)
          await Bun.sleep(1000)
        }
      }
    }
  }

  async function claimPending() {
    try {
      const pending = await redis.xpending(stream, group, '-', '+', '100')
      if (!Array.isArray(pending) || pending.length === 0) return

      for (const entry of pending) {
        const [id] = entry as [string, string, number, number]
        await redis.xclaim(stream, group, consumer, '30000', id)
      }
    } catch (err) {
      console.warn(`[queue:${name}] claimPending error:`, err)
    }
  }

  async function processJob(id: string, data: T, attemptsLeft: number) {
    try {
      await handler(data)
      await redis.xack(stream, group, id)
      await redis.xdel(stream, id)
    } catch (err) {
      if (attemptsLeft > 1) {
        const delay = backoffMs * (retries - attemptsLeft + 1)
        await Bun.sleep(delay)
        return processJob(id, data, attemptsLeft - 1)
      }

      // Dead letter
      await redis.xadd(
        'queue:dlq',
        '*',
        'source',
        name,
        'data',
        JSON.stringify(data),
        'error',
        String(err),
        'timestamp',
        new Date().toISOString(),
      )
      await redis.xack(stream, group, id)
      await redis.xdel(stream, id)
      console.error(`[queue:${name}] job sent to DLQ:`, err)
    }
  }

  function stop() {
    stopped = true
  }

  return { enqueue, start, stop, depth }
}
