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

  async acquire(): Promise<number> {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return 0
    }

    const timeSinceRefill = Date.now() - this.lastRefill
    const timeUntilRefill = this.intervalMs - timeSinceRefill
    const waitMs = Math.max(0, timeUntilRefill)

    await Bun.sleep(waitMs)
    this.refill()

    // Re-check after sleep — another caller may have consumed tokens
    if (this.tokens < 1) {
      return waitMs + (await this.acquire())
    }

    this.tokens -= 1
    return waitMs
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
