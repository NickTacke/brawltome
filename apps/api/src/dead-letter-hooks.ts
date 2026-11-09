import { accountsDeadLetterHooks } from '@brawltome/accounts/dead-letter-hooks'
import { clanDeadLetterHooks } from '@brawltome/clan/dead-letter-hooks'
import { playerDeadLetterHooks } from '@brawltome/player/dead-letter-hooks'
import type { DeadLetterHooks } from '@brawltome/queue'
import { rankingDeadLetterHooks } from '@brawltome/ranking/dead-letter-hooks'
import { statisticsDeadLetterHooks } from '@brawltome/statistics/dead-letter-hooks'

// each owner's narrow entry, not its package root: the operator CLI must not load the API server's dependencies
const ownerHooks = [
  accountsDeadLetterHooks,
  clanDeadLetterHooks,
  playerDeadLetterHooks,
  rankingDeadLetterHooks,
  statisticsDeadLetterHooks,
]

export function createDeadLetterHooks(): DeadLetterHooks {
  return {
    replayGuards: new Map(ownerHooks.flatMap((hooks) => [...hooks.replayGuards])),
    describeEffects: new Map(ownerHooks.flatMap((hooks) => [...hooks.describeEffects])),
  }
}
