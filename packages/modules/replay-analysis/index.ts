import type { BrawltomeModule } from '@brawltome/foundation'
import { createReplayJobs } from './migrations/0001-create-replay-jobs'
import { dropReplayJobs } from './migrations/0002-drop-replay-jobs'

const migrations = [createReplayJobs, dropReplayJobs] as const

// only the migrations are left: 0001 is deployed and must stay on record, 0002 drops what it made.
// 0001 references accounts.users
export const replayAnalysisModule = {
  name: 'replay-analysis',
  dependsOn: ['accounts'],
  migrations,
} satisfies BrawltomeModule
