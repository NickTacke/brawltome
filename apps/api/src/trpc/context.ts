import type { Account, Accounts } from '@brawltome/accounts'
import type { ClanQueries } from '@brawltome/clan'
import type { DiscoveryQueries } from '@brawltome/discovery'
import type { CareerPlayerQueries, PlayerReferenceQueries, RankedPlayerQueries } from '@brawltome/player'
import type { PlayerValhallanQueries, RankingQueries } from '@brawltome/ranking'
import type { InteractiveRefreshOperations } from '@brawltome/refresh-operations'
import type { ActorAdmission } from '@brawltome/request-admission'
import type { CareerWeaponUsageQueries, StatisticsHistoryQueries, StatisticsQueries } from '@brawltome/statistics'
import type { Telemetry } from '@brawltome/telemetry'

export interface Context {
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
  clanRepo: ClanQueries
  accounts: Accounts
  clientIp: string
  isBot: boolean
  internalSecret: string | undefined
  discordInternalSecret: string | undefined
  account: Account | null
}
