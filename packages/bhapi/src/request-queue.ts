import {
  brawlhallaV0RequestLimit,
  brawlhallaV0WindowMs,
  brawlhallaV1RequestLimit,
  brawlhallaV1WindowMs,
} from './budget'

export type Caller = 'on-demand' | 'background'

export interface RequestQueueOptions {
  minSpacingMs: number
  sustainedLimit: number
  sustainedWindowMs: number
  onDemandHeadroom?: number
}

export class RequestQueue {
  private readonly minSpacingMs: number
  private readonly sustainedLimit: number
  private readonly sustainedWindowMs: number
  private readonly onDemandHeadroom: number
  private readonly timestamps: number[] = []
  private lastRequestTime = 0
  private pausedUntil = 0
  private processing = false
  private wakeForNewRequest: (() => void) | undefined
  private readonly pending: Array<{ resolve: (waitMs: number) => void; enqueuedAt: number; caller: Caller }> = []

  constructor(opts: RequestQueueOptions) {
    if (!Number.isFinite(opts.minSpacingMs) || opts.minSpacingMs < 0) {
      throw new RangeError('minSpacingMs must be a finite number >= 0')
    }

    if (!Number.isInteger(opts.sustainedLimit) || opts.sustainedLimit < 1) {
      throw new RangeError('sustainedLimit must be an integer >= 1')
    }

    if (!Number.isFinite(opts.sustainedWindowMs) || opts.sustainedWindowMs < 1) {
      throw new RangeError('sustainedWindowMs must be a finite number >= 1')
    }

    const headroom = opts.onDemandHeadroom ?? 0

    if (!Number.isInteger(headroom) || headroom < 0 || headroom >= opts.sustainedLimit) {
      throw new RangeError('onDemandHeadroom must be an integer in [0, sustainedLimit)')
    }

    this.minSpacingMs = opts.minSpacingMs
    this.sustainedLimit = opts.sustainedLimit
    this.sustainedWindowMs = opts.sustainedWindowMs
    this.onDemandHeadroom = headroom
  }

  private effectiveLimit(caller: Caller): number {
    if (caller === 'on-demand') return this.sustainedLimit

    return Math.max(1, this.sustainedLimit - this.onDemandHeadroom)
  }

  get remainingOnDemand(): number {
    this.pruneTimestamps()

    return Math.max(0, this.effectiveLimit('on-demand') - this.timestamps.length)
  }

  get remainingBackground(): number {
    this.pruneTimestamps()

    return Math.max(0, this.effectiveLimit('background') - this.timestamps.length)
  }

  get isPaused(): boolean {
    return Date.now() < this.pausedUntil
  }

  pause(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return

    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + durationMs)
  }

  async acquire(caller: Caller): Promise<number> {
    return new Promise<number>((resolve) => {
      this.pending.push({ resolve, enqueuedAt: Date.now(), caller })
      this.wakeForNewRequest?.()
      this.processNext()
    })
  }

  private async processNext(): Promise<void> {
    if (this.processing) return

    if (this.pending.length === 0) return

    this.processing = true

    while (this.pending.length > 0) {
      await this.waitForPauseAndSpacing()

      // in arrival order, but a background call out of budget must not hold up on-demand calls behind it
      const index = this.pending.findIndex((entry) => this.hasBudget(entry.caller))

      if (index === -1) {
        await this.waitForBudgetOrNewRequest()
        continue
      }

      const [granted] = this.pending.splice(index, 1)
      const now = Date.now()

      this.lastRequestTime = now
      this.timestamps.push(now)
      granted.resolve(now - granted.enqueuedAt)
    }

    this.processing = false
  }

  private hasBudget(caller: Caller): boolean {
    this.pruneTimestamps()

    return this.timestamps.length < this.effectiveLimit(caller)
  }

  private async waitForPauseAndSpacing(): Promise<void> {
    await this.waitWhilePaused()

    const sinceLast = Date.now() - this.lastRequestTime

    if (this.lastRequestTime > 0 && sinceLast < this.minSpacingMs) {
      await Bun.sleep(this.minSpacingMs - sinceLast)
      await this.waitWhilePaused()
    }
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.isPaused) {
      const pauseWait = this.pausedUntil - Date.now()

      if (pauseWait > 0) await Bun.sleep(pauseWait)
    }
  }

  // a new request can be on-demand and fit in the headroom, so it ends the wait early
  private waitForBudgetOrNewRequest(): Promise<void> {
    const budgetWaitMs = Math.max(0, this.timestamps[0] + this.sustainedWindowMs - Date.now())

    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        this.wakeForNewRequest = undefined
        resolve()
      }

      const timer = setTimeout(finish, budgetWaitMs)

      this.wakeForNewRequest = finish
    })
  }

  private pruneTimestamps(): void {
    const cutoff = Date.now() - this.sustainedWindowMs
    let i = 0

    while (i < this.timestamps.length && this.timestamps[i] < cutoff) i++
    if (i > 0) this.timestamps.splice(0, i)
  }
}

export function createBhApiRequestQueue(onDemandHeadroom = 30): RequestQueue {
  return new RequestQueue({
    minSpacingMs: 150,
    sustainedLimit: brawlhallaV0RequestLimit,
    sustainedWindowMs: brawlhallaV0WindowMs,
    onDemandHeadroom,
  })
}

export function createBhApiV1RequestQueue(
  requestLimit = brawlhallaV1RequestLimit,
  onDemandHeadroom = 30,
): RequestQueue {
  return new RequestQueue({
    minSpacingMs: 150,
    sustainedLimit: requestLimit,
    sustainedWindowMs: brawlhallaV1WindowMs,
    onDemandHeadroom,
  })
}
