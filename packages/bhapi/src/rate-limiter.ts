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
  private lastRefill: number

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity
    this.refillRate = opts.refillRate
    this.intervalMs = opts.intervalMs
    this.tokens = opts.capacity
    this.lastRefill = Date.now()
  }

  get remaining(): number {
    this.refill()
    return this.tokens
  }

  drain(): void {
    this.tokens = 0
  }

  async acquire(): Promise<number> {
    let totalWaitMs = 0

    while (true) {
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return totalWaitMs
      }

      const timeSinceRefill = Date.now() - this.lastRefill
      const timeUntilRefill = this.intervalMs - timeSinceRefill
      const waitMs = Math.max(0, timeUntilRefill)

      await Bun.sleep(waitMs)
      totalWaitMs += waitMs
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill

    if (elapsed >= this.intervalMs) {
      const intervals = Math.floor(elapsed / this.intervalMs)
      this.tokens = Math.min(this.capacity, this.tokens + intervals * this.refillRate)
      this.lastRefill += intervals * this.intervalMs
    }
  }
}
