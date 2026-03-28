export interface RequestQueueOptions {
  minSpacingMs: number
  sustainedLimit: number
  sustainedWindowMs: number
}

export class RequestQueue {
  private readonly minSpacingMs: number
  private readonly sustainedLimit: number
  private readonly sustainedWindowMs: number
  private readonly timestamps: number[] = []
  private lastRequestTime = 0
  private pausedUntil = 0
  private processing = false
  private readonly pending: Array<{ resolve: (waitMs: number) => void; enqueuedAt: number }> = []

  constructor(opts: RequestQueueOptions) {
    this.minSpacingMs = opts.minSpacingMs
    this.sustainedLimit = opts.sustainedLimit
    this.sustainedWindowMs = opts.sustainedWindowMs
  }

  get remaining(): number {
    this.pruneTimestamps()
    return Math.max(0, this.sustainedLimit - this.timestamps.length)
  }

  get isPaused(): boolean {
    return Date.now() < this.pausedUntil
  }

  pause(durationMs: number): void {
    this.pausedUntil = Date.now() + durationMs
  }

  async acquire(): Promise<number> {
    return new Promise<number>((resolve) => {
      this.pending.push({ resolve, enqueuedAt: Date.now() })
      this.processNext()
    })
  }

  private async processNext(): Promise<void> {
    if (this.processing) return
    if (this.pending.length === 0) return
    this.processing = true

    while (this.pending.length > 0) {
      await this.waitForSlot()
      const caller = this.pending.shift()!
      const now = Date.now()
      this.lastRequestTime = now
      this.timestamps.push(now)
      caller.resolve(now - caller.enqueuedAt)
    }

    this.processing = false
  }

  private async waitForSlot(): Promise<void> {
    // Wait for pause to expire
    if (this.isPaused) {
      const pauseWait = this.pausedUntil - Date.now()
      if (pauseWait > 0) {
        await Bun.sleep(pauseWait)
      }
    }

    // Wait for burst spacing
    const sinceLast = Date.now() - this.lastRequestTime
    if (this.lastRequestTime > 0 && sinceLast < this.minSpacingMs) {
      await Bun.sleep(this.minSpacingMs - sinceLast)
    }

    // Wait for sustained window
    this.pruneTimestamps()
    if (this.timestamps.length >= this.sustainedLimit) {
      const oldest = this.timestamps[0]
      const sustainedWait = oldest + this.sustainedWindowMs - Date.now()
      if (sustainedWait > 0) {
        await Bun.sleep(sustainedWait)
        this.pruneTimestamps()
      }
    }
  }

  private pruneTimestamps(): void {
    const cutoff = Date.now() - this.sustainedWindowMs
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift()
    }
  }
}
