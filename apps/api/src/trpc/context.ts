import type { Account, Accounts } from '@brawltome/accounts'
import type { ClanRepo } from '@brawltome/clan'
import type { Database } from '@brawltome/database'
import type { PlayerLinkRepo } from '@brawltome/identity'
import type { MatchRepo } from '@brawltome/matchmaking'
import type { CareerPlayerQueries, PlayerReferenceQueries, RankedPlayerQueries } from '@brawltome/player'
import type { PlayerRepo } from '@brawltome/player/v2-compatibility'
import type { RankingQueries } from '@brawltome/ranking'
import type { InteractiveRefreshOperations } from '@brawltome/refresh-operations'
import type { ActorAdmission } from '@brawltome/request-admission'
import type { MetricsRegistry, Queue, R2Client } from '@brawltome/shared'
import type { Redis } from 'ioredis'

export interface Context {
  db: Database
  redis: Redis
  metrics: MetricsRegistry
  rankedQueue: Queue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>
  statsQueue: Queue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>
  playerRepo: PlayerRepo
  playerReferenceQueries: PlayerReferenceQueries
  rankedPlayerQueries: RankedPlayerQueries
  careerPlayerQueries: CareerPlayerQueries
  refreshOperations: InteractiveRefreshOperations
  requestAdmission: ActorAdmission
  refreshTrust: { trusted: boolean; grant(): void }
  verifyRefreshChallenge(token: string, remoteIp: string): Promise<'valid' | 'invalid' | 'unavailable'>
  rankingQueries: RankingQueries
  clanRepo: ClanRepo
  accounts: Accounts
  playerLinkRepo: PlayerLinkRepo
  steamLinkQueue: Queue<{ userId: string; steamId: string; caller: 'background' }>
  clientIp: string
  isBot: boolean
  internalSecret: string | undefined
  account: Account | null
  matchRepo: MatchRepo | null
  r2: R2Client | null
  matchmakingEnabled: boolean
}
