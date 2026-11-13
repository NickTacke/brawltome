import type { BrawltomeModule } from '@brawltome/foundation'
import { createReplayProcedures } from './api/procedures'
import { createReplays } from './migrations/0001-create-replays'
import { addWorkerReports } from './migrations/0002-add-worker-reports'

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

const migrations = [createReplays, addWorkerReports] as const

export const replaysModule = {
  name: 'replays' as const,
  dependsOn: ['accounts'],
  migrations,
  routes: createReplayProcedures,
} satisfies BrawltomeModule
