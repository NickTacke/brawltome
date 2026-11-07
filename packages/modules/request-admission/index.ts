import type { BrawltomeModule } from '@brawltome/foundation'
import { initializeRequestAdmission } from './migrations/0001-initialize-admission'
import { addActorReservations } from './migrations/0002-add-actor-reservations'
import { addSourceBackoffs } from './migrations/0003-add-source-backoffs'

export { createPostgresRequestAdmission, type PostgresRequestAdmission } from './postgres'

const migrations = [initializeRequestAdmission, addActorReservations, addSourceBackoffs] as const

export const requestAdmissionModule = {
  name: 'request-admission',
  dependsOn: [],
  migrations,
} satisfies BrawltomeModule

export type AdmissionActor =
  | { kind: 'verified-anonymous'; ip: string }
  | { kind: 'authenticated'; accountId: string; ip: string }
  | { kind: 'discord'; discordUserId: string }
  | { kind: 'desktop'; ip: string }
  | { kind: 'profile-view'; ip: string }

export type ActorAdmissionResult = { outcome: 'admitted' } | { outcome: 'rate-limited'; retryAfterSeconds: number }

export type SourceDomain = 'brawlhalla-v0' | 'brawlhalla-v1'
export type SourceCaller = 'on-demand' | 'background'

export type SourceAdmissionResult =
  | { outcome: 'admitted'; deduplicated: boolean }
  | { outcome: 'rate-limited'; retryAfterSeconds: number }

export type SourceQuotaUsage = {
  observedAt: string
  windowStartedAt: string
  domains: { domain: SourceDomain; used: number; limit: number }[]
}

export interface ActorAdmission {
  admitActor(actor: AdmissionActor, reservationKey: string): Promise<ActorAdmissionResult>
  admitActorOnce(actor: AdmissionActor): Promise<ActorAdmissionResult>
  hasActorReservation(reservationKey: string): Promise<boolean>
}

export interface SourceAdmission {
  admitSource(input: {
    domain: SourceDomain
    reservationKey: string
    units: number
    caller?: SourceCaller
  }): Promise<SourceAdmissionResult>
  pauseSource(domain: SourceDomain, retryAfterSeconds: number): Promise<void>
}
