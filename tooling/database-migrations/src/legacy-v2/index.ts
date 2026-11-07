import type { BrawltomeModule } from '@brawltome/foundation'
import { dropV2Tables } from './migrations/0001-drop-v2-tables'

// the V2 app's tables in public and its drizzle schema; every module imported what it needed from them, and the
// raw dump is archived in R2
export const legacyV2Module = {
  name: 'legacy-v2',
  dependsOn: [],
  migrations: [dropV2Tables],
} satisfies BrawltomeModule
