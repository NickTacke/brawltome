import type { ClanRepo } from '@brawltome/clan'
import type { Database } from '@brawltome/database'
import type { PlayerLinkRepo, Session, SessionRepo, UserRepo, UserWithPrimaryAccount } from '@brawltome/identity'
import type { PlayerRepo } from '@brawltome/player'
import type { RankingRepo } from '@brawltome/ranking'
import type { Queue } from '@brawltome/shared'
import type { Redis } from 'ioredis'

export interface Context {
  db: Database
  redis: Redis
  rankedQueue: Queue<{ brawlhallaId: number }>
  statsQueue: Queue<{ brawlhallaId: number }>
  clanQueue: Queue<{ clanId: number }>
  playerRepo: PlayerRepo
  clanRepo: ClanRepo
  rankingRepo: RankingRepo
  userRepo: UserRepo
  sessionRepo: SessionRepo
  playerLinkRepo: PlayerLinkRepo
  steamLinkQueue: Queue<{ userId: string; steamId: string }>
  clientIp: string
  isBot: boolean
  internalSecret: string | undefined
  user: UserWithPrimaryAccount | null
  session: Session | null
}
