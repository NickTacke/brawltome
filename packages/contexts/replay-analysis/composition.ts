import { createReplayJobs } from './migrations/0001-create-replay-jobs'

export { createPostgresReplayAnalysisJobs } from './postgres'

export const replayAnalysisMigrationInventory = [createReplayJobs] as const
