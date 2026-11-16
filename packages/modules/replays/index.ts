import type { BrawltomeModule } from '@brawltome/foundation'
import { createReplayProcedures } from './api/procedures'
import { createReplays } from './migrations/0001-create-replays'
import { addWorkerReports } from './migrations/0002-add-worker-reports'
import { addArt } from './migrations/0003-add-art'

export type { ClaimedArtJob, ReadArtOutcome, ReplayArtJobs, StoreArtOutcome } from './art'
export type { ArtMap, ArtResult } from './art-complete'
export type { ArtFailure, ArtFailureCode } from './art-lease'
export { parseArtPath } from './art-paths'
export {
  type ClaimedJob,
  type CompleteOutcome,
  createReplayJobs,
  type JobFailureCode,
  type ReplayJobs,
} from './jobs'
export * from './keys'
export * from './limits'
export { inspectReplayQueue, type ReplayQueueInspection } from './maintenance'
export type { ReplaysDeps, WorkerReport } from './model'
export { type UploadFile, type UploadOutcome, type UploadRejectionCode, uploadReplays } from './upload'

const migrations = [createReplays, addWorkerReports, addArt] as const

export const replaysModule = {
  name: 'replays' as const,
  dependsOn: ['accounts'],
  migrations,
  routes: createReplayProcedures,
} satisfies BrawltomeModule
