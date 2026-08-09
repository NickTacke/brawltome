function positiveInteger(value: string | undefined, fallback: number, name: string, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`)
  }
  return parsed
}

export function readOperationsWorkerConfig(env: NodeJS.ProcessEnv) {
  return {
    leaseMs: positiveInteger(env.OPERATIONS_LEASE_MS, 30_000, 'OPERATIONS_LEASE_MS', 300_000),
    pollMs: positiveInteger(env.OPERATIONS_POLL_MS, 1_000, 'OPERATIONS_POLL_MS', 60_000),
    retryDelayMs: positiveInteger(env.OPERATIONS_RETRY_DELAY_MS, 1_000, 'OPERATIONS_RETRY_DELAY_MS', 300_000),
  }
}
