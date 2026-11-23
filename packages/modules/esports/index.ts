import type { BrawltomeModule } from '@brawltome/foundation'
import { createEsports } from './migrations/0001-create-esports'

const migrations = [createEsports] as const

export const esportsModule = {
  // a literal, so the API router can serve the procedures under this name with their types
  name: 'esports' as const,
  dependsOn: ['queue', 'player'],
  migrations,
  // no procedures yet; the player page's esports read adds them
  routes: () => ({}),
} satisfies BrawltomeModule
