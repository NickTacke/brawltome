function integerInRange(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return parsed
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv) {
  const shutdownDeadlineMs = integerInRange(
    env.RUNTIME_SHUTDOWN_DEADLINE_MS,
    60_000,
    'RUNTIME_SHUTDOWN_DEADLINE_MS',
    1_000,
    300_000,
  )
  const cleanupReserveMs = integerInRange(
    env.RUNTIME_CLEANUP_RESERVE_MS,
    Math.min(5_000, Math.floor(shutdownDeadlineMs / 4)),
    'RUNTIME_CLEANUP_RESERVE_MS',
    0,
    shutdownDeadlineMs - 1,
  )
  return { shutdownDeadlineMs, cleanupReserveMs }
}

export function readHealthPort(value: string | undefined, fallback: number): number {
  return integerInRange(value, fallback, 'HEALTH_PORT', 1, 65_535)
}
