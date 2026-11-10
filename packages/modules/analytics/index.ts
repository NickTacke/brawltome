import type { BrawltomeModule } from '@brawltome/foundation'
import { createDailySalts } from './migrations/0001-create-daily-salts'

export { createPostgresDailySalts } from './db/postgres-daily-salts'

const migrations = [createDailySalts] as const

export const analyticsModule = {
  name: 'analytics',
  dependsOn: [],
  migrations,
} satisfies BrawltomeModule
