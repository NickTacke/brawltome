import { parseBoundedInteger, parsePositiveInteger } from '@brawltome/foundation'

const maximumPort = 65_535

export function readRuntimeConfig(env: NodeJS.ProcessEnv) {
  const shutdownDeadlineMs = parseBoundedInteger(env.RUNTIME_SHUTDOWN_DEADLINE_MS, {
    name: 'RUNTIME_SHUTDOWN_DEADLINE_MS',
    fallback: 60_000,
    minimum: 1_000,
    maximum: 300_000,
  })

  const cleanupReserveMs = parseBoundedInteger(env.RUNTIME_CLEANUP_RESERVE_MS, {
    name: 'RUNTIME_CLEANUP_RESERVE_MS',
    fallback: Math.min(5_000, Math.floor(shutdownDeadlineMs / 4)),
    minimum: 0,
    maximum: shutdownDeadlineMs - 1,
  })

  return { shutdownDeadlineMs, cleanupReserveMs }
}

export function readShutdownAnnounceMs(value: string | undefined): number {
  return parseBoundedInteger(value, { name: 'RUNTIME_SHUTDOWN_ANNOUNCE_MS', fallback: 0, minimum: 0, maximum: 30_000 })
}

export function readPort(name: 'PORT' | 'HEALTH_PORT', value: string | undefined, fallback: number): number {
  return parsePositiveInteger(value, { name, fallback, maximum: maximumPort })
}

// the API and the worker build the same admission tables, so they must read the same limit
export function readAuthenticatedRefreshIpLimit(value: string | undefined): number {
  return parsePositiveInteger(value, { name: 'AUTHENTICATED_REFRESH_IP_LIMIT', fallback: 120 })
}
