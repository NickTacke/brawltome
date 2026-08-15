import type { Account, Accounts } from '@brawltome/accounts'
import type { ClanRepo } from '@brawltome/clan'
import type { Database } from '@brawltome/database'
import type { DiscoveryQueries } from '@brawltome/discovery'
import type { MatchRepo } from '@brawltome/matchmaking'
import type { CareerPlayerQueries, PlayerReferenceQueries, RankedPlayerQueries } from '@brawltome/player'
import type { PlayerValhallanQueries, RankingQueries } from '@brawltome/ranking'
import type { InteractiveRefreshOperations } from '@brawltome/refresh-operations'
import type { ActorAdmission } from '@brawltome/request-admission'
import type { R2Client } from '@brawltome/shared'
import type { CareerWeaponUsageQueries, StatisticsHistoryQueries, StatisticsQueries } from '@brawltome/statistics'
import type { Telemetry } from '@brawltome/telemetry'

export interface Context {
  db: Database
  telemetry: Telemetry
  playerReferenceQueries: PlayerReferenceQueries
  discoveryQueries: DiscoveryQueries
  rankedPlayerQueries: RankedPlayerQueries
  careerPlayerQueries: CareerPlayerQueries
  refreshOperations: InteractiveRefreshOperations
  requestAdmission: ActorAdmission
  refreshTrust: { trusted: boolean; grant(): void }
  verifyRefreshChallenge(token: string, remoteIp: string): Promise<'valid' | 'invalid' | 'unavailable'>
  rankingQueries: RankingQueries & PlayerValhallanQueries
  statisticsQueries: StatisticsQueries & CareerWeaponUsageQueries & StatisticsHistoryQueries
  clanRepo: ClanRepo
  accounts: Accounts
  clientIp: string
  isBot: boolean
  internalSecret: string | undefined
  discordInternalSecret: string | undefined
  account: Account | null
  matchRepo: MatchRepo | null
  r2: R2Client | null
  matchmakingEnabled: boolean
}
