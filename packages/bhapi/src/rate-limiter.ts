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

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity
    this.refillRate = opts.refillRate
    this.intervalMs = opts.intervalMs
    this.msPerToken = opts.intervalMs / opts.refillRate
    this.tokens = opts.capacity
    this.lastRefill = Date.now()
  }

  get remaining(): number {
    this.refill()
    return Math.floor(this.tokens)
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

      // Wait for exactly 1 token to be available
      const waitMs = Math.max(0, this.msPerToken - (Date.now() - this.lastRefill))

      await Bun.sleep(waitMs)
      totalWaitMs += waitMs
    }
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill

    if (elapsed > 0) {
      const newTokens = elapsed / this.msPerToken
      this.tokens = Math.min(this.capacity, this.tokens + newTokens)
      this.lastRefill = now
    }
  }
}
