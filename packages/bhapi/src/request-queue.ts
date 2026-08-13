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

  get pausedUntilMs(): number {
    return this.pausedUntil
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
      this.processNext()
    })
  }

  private async processNext(): Promise<void> {
    if (this.processing) return
    if (this.pending.length === 0) return
    this.processing = true

    while (this.pending.length > 0) {
      const next = this.pending[0]
      await this.waitForSlot(next.caller)
      const popped = this.pending.shift()
      if (!popped) break
      const now = Date.now()
      this.lastRequestTime = now
      this.timestamps.push(now)
      popped.resolve(now - popped.enqueuedAt)
    }

    this.processing = false
  }

  private async waitForSlot(caller: Caller): Promise<void> {
    const limit = this.effectiveLimit(caller)

    while (this.isPaused) {
      const pauseWait = this.pausedUntil - Date.now()
      if (pauseWait > 0) await Bun.sleep(pauseWait)
    }

    const sinceLast = Date.now() - this.lastRequestTime
    if (this.lastRequestTime > 0 && sinceLast < this.minSpacingMs) {
      await Bun.sleep(this.minSpacingMs - sinceLast)
      while (this.isPaused) {
        const pauseWait = this.pausedUntil - Date.now()
        if (pauseWait > 0) await Bun.sleep(pauseWait)
      }
    }

    while (true) {
      while (this.isPaused) {
        const pauseWait = this.pausedUntil - Date.now()
        if (pauseWait > 0) await Bun.sleep(pauseWait)
      }
      this.pruneTimestamps()
      if (this.timestamps.length < limit) break
      const oldest = this.timestamps[0]
      const sustainedWait = oldest + this.sustainedWindowMs - Date.now()
      if (sustainedWait > 0) await Bun.sleep(sustainedWait)
    }
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
    sustainedLimit: 180,
    sustainedWindowMs: 15 * 60 * 1_000,
    onDemandHeadroom,
  })
}
