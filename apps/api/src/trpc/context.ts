import type { Database } from '@brawltome/database'
import type { Redis } from 'ioredis'
import type { Queue } from '../queue/queue'

export interface Context {
  db: Database
  redis: Redis
  rankedQueue: Queue<{ brawlhallaId: number }>
  statsQueue: Queue<{ brawlhallaId: number }>
  clanQueue: Queue<{ clanId: number }>
  clientIp: string
  isBot: boolean
  internalSecret: string | undefined
  turnstileToken: string | undefined
}
