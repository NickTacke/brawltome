import type { ClanRepo } from '@brawltome/clan'
import type { Database } from '@brawltome/database'
import type { PlayerLinkRepo, Session, SessionRepo, UserRepo, UserWithPrimaryAccount } from '@brawltome/identity'
import type { MatchRepo } from '@brawltome/matchmaking'
import type { PlayerRepo } from '@brawltome/player'
import type { MetricsRegistry, Queue, R2Client } from '@brawltome/shared'
import type { Redis } from 'ioredis'

export interface Context {
  db: Database
  redis: Redis
  metrics: MetricsRegistry
  rankedQueue: Queue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>
  statsQueue: Queue<{ brawlhallaId: number; caller: 'on-demand' | 'background' }>
  clanQueue: Queue<{ clanId: number; caller: 'on-demand' | 'background' }>
  playerRepo: PlayerRepo
  clanRepo: ClanRepo
  userRepo: UserRepo
  sessionRepo: SessionRepo
  playerLinkRepo: PlayerLinkRepo
  steamLinkQueue: Queue<{ userId: string; steamId: string; caller: 'background' }>
  clientIp: string
  isBot: boolean
  internalSecret: string | undefined
  user: UserWithPrimaryAccount | null
  session: Session | null
  matchRepo: MatchRepo | null
  r2: R2Client | null
  matchmakingEnabled: boolean
}
