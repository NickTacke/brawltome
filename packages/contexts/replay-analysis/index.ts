export type ReplayJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export class ActiveReplayJobError extends Error {}

export type ReplayJobFailure = {
  code: string
  message: string
}

export type ReplayJobSummary = {
  id: string
  status: ReplayJobStatus
  fileName: string | null
  createdAt: string
  updatedAt: string
  failure: ReplayJobFailure | null
}

export type ReplayJobDetail = ReplayJobSummary & {
  result: unknown | null
}

export type ClaimedReplayJob = {
  id: string
  leaseToken: string
  replayBytes: Uint8Array
  replayDigest: string
}

export interface ReplayAnalysisJobs {
  create(input: {
    accountId: string
    replayBytes: Uint8Array
    replayDigest: string
    fileName: string | null
  }): Promise<ReplayJobSummary>
  list(accountId: string, limit?: number): Promise<ReplayJobSummary[]>
  get(accountId: string, id: string): Promise<ReplayJobDetail | null>
  claim(leaseSeconds: number): Promise<ClaimedReplayJob | null>
  complete(
    id: string,
    leaseToken: string,
    replayDigest: string,
    result: unknown,
  ): Promise<'completed' | 'digest-mismatch' | 'lease-lost' | 'not-found'>
  fail(id: string, leaseToken: string, failure: ReplayJobFailure): Promise<boolean>
  renew(id: string, leaseToken: string, leaseSeconds: number): Promise<boolean>
  release(id: string, leaseToken: string): Promise<boolean>
  close(): Promise<void>
}

export { createPostgresReplayAnalysisJobs } from './postgres'
