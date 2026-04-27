export function isStale(lastUpdated: Date | null, now: number, ttlMs: number): boolean {
  if (lastUpdated === null) return true
  return now - lastUpdated.getTime() > ttlMs
}
