import type { BrawltomeModule } from '@brawltome/foundation'
import { createReplayJobs } from './migrations/0001-create-replay-jobs'

export * from './model'
export { createPostgresReplayAnalysisJobs } from './postgres'

const migrations = [createReplayJobs] as const

// replay_analysis.jobs references accounts.users
export const replayAnalysisModule = {
  name: 'replay-analysis',
  dependsOn: ['accounts'],
  migrations,
} satisfies BrawltomeModule
