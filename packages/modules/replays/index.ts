import type { BrawltomeModule } from '@brawltome/foundation'
import { createReplays } from './migrations/0001-create-replays'

export {
  type ClaimedJob,
  type CompleteOutcome,
  createReplayJobs,
  type JobFailureCode,
  type ReplayJobs,
  type WorkerReport,
} from './jobs'
export * from './keys'
export * from './limits'
export type { ReplaysDeps } from './model'
export { type UploadFile, type UploadOutcome, type UploadRejectionCode, uploadReplays } from './upload'

const migrations = [createReplays] as const

export const replaysModule = {
  name: 'replays' as const,
  // queue: the file cleanup runs as a scheduled job
  dependsOn: ['accounts', 'queue'],
  migrations,
} satisfies BrawltomeModule
