import type { Database } from '@brawltome/foundation'
import { countActive } from '@brawltome/queue'

const playerRefreshKind = 'interactive-player-refresh'

/** Background player refreshes of every cohort and assignment that are waiting, queued or running. */
export function activeBackgroundPlayerRefreshes(database: Database): Promise<number> {
  return countActive(database, { kind: playerRefreshKind, workClass: 'primary-monitoring', payloadEquals: {} })
}

/** Player refreshes a visitor, the overlay or Discord asked for that are waiting, queued or running. */
export function activeInteractivePlayerRefreshes(database: Database): Promise<number> {
  return countActive(database, { kind: playerRefreshKind, workClass: 'interactive', payloadEquals: {} })
}
