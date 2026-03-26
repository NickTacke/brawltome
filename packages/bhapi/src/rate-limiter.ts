export interface TokenBucketOptions {
  capacity: number
  refillRate: number
  intervalMs: number
}

export class TokenBucket {
  private tokens: number
  private readonly capacity: number
  private readonly refillRate: number
  private readonly intervalMs: number
  private readonly msPerToken: number
  private lastRefill: number
  private pausedUntil: number

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity
    this.refillRate = opts.refillRate
    this.intervalMs = opts.intervalMs
    this.msPerToken = opts.intervalMs / opts.refillRate
    this.tokens = opts.capacity
    this.lastRefill = Date.now()
    this.pausedUntil = 0
  }

  get remaining(): number {
    this.refill()
    return Math.floor(this.tokens)
  }

  /** Pause the bucket — no tokens refill or are granted until the pause expires. */
  pause(durationMs: number): void {
    this.tokens = 0
    this.pausedUntil = Date.now() + durationMs
  }

  get isPaused(): boolean {
    return Date.now() < this.pausedUntil
  }

  async acquire(): Promise<number> {
    let totalWaitMs = 0

    // If paused, wait until pause expires
    if (this.isPaused) {
      const waitMs = this.pausedUntil - Date.now()
      if (waitMs > 0) {
        await Bun.sleep(waitMs)
        totalWaitMs += waitMs
      }
      // Only the first caller to wake resets the bucket
      if (this.pausedUntil > 0 && Date.now() >= this.pausedUntil) {
        this.lastRefill = Date.now()
        this.tokens = 1
        this.pausedUntil = 0
      }
    }

    while (true) {
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return totalWaitMs
      }

      // Wait for exactly 1 token to be available
      const waitMs = Math.max(0, this.msPerToken - (Date.now() - this.lastRefill))

      await Bun.sleep(waitMs)
      totalWaitMs += waitMs
    }
  }

  private refill(): void {
    if (this.isPaused) return

    const now = Date.now()
    const elapsed = now - this.lastRefill

    if (elapsed > 0) {
      const newTokens = elapsed / this.msPerToken
      this.tokens = Math.min(this.capacity, this.tokens + newTokens)
      this.lastRefill = now
    }
  }
}
