import { RateLimitError } from '@brawltome/bhapi'
import type { Redis } from 'ioredis'
import type { MetricsRegistry } from './metrics'

export interface QueueOptions<T = unknown> {
  concurrency?: number
  retries?: number
  backoffMs?: number
  maxDepth?: number
  dedupKey?: (data: T) => string
  dedupTtlSec?: number
  priorityRatio?: number
  claimMinIdleMs?: number
  metrics?: MetricsRegistry
}

export interface Queue<T> {
  enqueue(data: T, priority?: boolean): Promise<boolean>
  start(): Promise<void>
  stop(): void
  depth(): Promise<number>
}

export function createQueue<T>(
  redis: Redis,
  name: string,
  handler: (data: T) => Promise<void>,
  opts: QueueOptions<T> = {},
): Queue<T> {
  const {
    concurrency = 5,
    retries = 3,
    backoffMs = 1000,
    maxDepth,
    dedupKey,
    dedupTtlSec = 300,
    priorityRatio = Number.POSITIVE_INFINITY,
    claimMinIdleMs = 30000,
    metrics,
  } = opts
  function dedupRedisKey(resolver: (data: T) => string, data: T): string {
    return `queue:${name}:dedup:${resolver(data)}`
  }

  async function releaseDedup(data: T): Promise<void> {
    if (dedupKey) {
      try {
        await redis.del(dedupRedisKey(dedupKey, data))
      } catch (err) {
        console.warn(`[queue:${name}] releaseDedup error:`, err)
      }
    }
  }

  const stream = `queue:${name}`
  const priorityKey = `queue:${name}:priority`
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

  async function enqueue(data: T, priority = false): Promise<boolean> {
    if (maxDepth !== undefined) {
      const streamLen = await redis.xlen(stream)
      const priorityLen = await redis.llen(priorityKey)
      if (streamLen + priorityLen >= maxDepth) {
        await metrics?.incrementQueue(name, 'rejected_total')
        return false
      }
    }

    if (dedupKey) {
      const set = await redis.set(dedupRedisKey(dedupKey, data), '1', 'EX', dedupTtlSec, 'NX')
      if (set !== 'OK') {
        await metrics?.incrementQueue(name, 'dedup_skipped_total')
        return false
      }
    }

    if (priority) {
      await redis.lpush(priorityKey, JSON.stringify(data))
    } else {
      await redis.xadd(stream, '*', 'data', JSON.stringify(data))
    }
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
    // Recover orphaned pending jobs in the background; do not block the read loop on it.
    void claimPending()

    let consecutivePriority = 0

    while (!stopped) {
      if (running >= concurrency) {
        await Bun.sleep(50)
        continue
      }

      // Try priority first, but only if we haven't exceeded the ratio
      if (consecutivePriority < priorityRatio) {
        try {
          const priorityItem = await redis.rpop(priorityKey)
          if (priorityItem) {
            consecutivePriority++
            running++
            await metrics?.incrementQueue(name, 'priority_drained_total')
            processJob(null, JSON.parse(priorityItem) as T, retries).finally(() => {
              running--
            })
            continue
          }
        } catch (err) {
          if (!stopped) console.error(`[queue:${name}] priority read error:`, err)
        }
      }

      const ratioCapHit = consecutivePriority >= priorityRatio

      try {
        // Redis XREADGROUP: omitting BLOCK is non-blocking; BLOCK 0 means block forever.
        // When the ratio cap is hit, we want to return to priority asap, so use the non-blocking form.
        const messages = ratioCapHit
          ? await redis.xreadgroup(
              'GROUP',
              group,
              consumer,
              'COUNT',
              String(concurrency - running),
              'STREAMS',
              stream,
              '>',
            )
          : await redis.xreadgroup(
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

        if (!messages || stopped) {
          consecutivePriority = 0 // regular stream empty - let priority drain again
          if (ratioCapHit) await Bun.sleep(50)
          continue
        }

        for (const [, entries] of messages as [string, [string, string[]][]][]) {
          for (const [id, fields] of entries) {
            consecutivePriority = 0 // reset after any regular drain
            running++
            await metrics?.incrementQueue(name, 'regular_drained_total')
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
        if (stopped) return
        const [id] = entry as [string, string, number, number]
        const claimed = await redis.xclaim(stream, group, consumer, String(claimMinIdleMs), id)
        if (!Array.isArray(claimed)) continue
        for (const [claimedId, fields] of claimed as [string, string[]][]) {
          if (stopped) return
          while (running >= concurrency && !stopped) await Bun.sleep(50)
          if (stopped) return
          running++
          processJob(claimedId, JSON.parse(fields[1]) as T, retries).finally(() => {
            running--
          })
        }
      }
    } catch (err) {
      if (!stopped) console.warn(`[queue:${name}] claimPending error:`, err)
    }
  }

  async function ackAndDelete(id: string | null) {
    if (id) {
      await redis.xack(stream, group, id)
      await redis.xdel(stream, id)
    }
  }

  async function processJob(id: string | null, data: T, attemptsLeft: number) {
    try {
      await handler(data)
      await ackAndDelete(id)
      await releaseDedup(data)
    } catch (err) {
      if (err instanceof RateLimitError) {
        console.warn(`[queue:${name}] rate limited, sleeping ${err.retryAfterMs}ms before re-enqueue`)
        await metrics?.incrementQueue(name, 'rate_limit_retries_total')
        const wasPriority = id === null
        await ackAndDelete(id)
        await releaseDedup(data)
        await Bun.sleep(err.retryAfterMs)
        await enqueue(data, wasPriority)
        return
      }

      if (attemptsLeft > 1) {
        const delay = backoffMs * (retries - attemptsLeft + 1)
        await Bun.sleep(delay)
        return processJob(id, data, attemptsLeft - 1)
      }

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
      await ackAndDelete(id)
      await releaseDedup(data)
      console.error(`[queue:${name}] job sent to DLQ:`, err)
    }
  }

  function stop() {
    stopped = true
  }

  return { enqueue, start, stop, depth }
}
