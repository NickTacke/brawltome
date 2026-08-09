export type RefreshActor =
  | { kind: 'verified-anonymous'; ip: string }
  | { kind: 'authenticated'; accountId: string; ip: string }
  | { kind: 'discord'; discordUserId: string }
  | { kind: 'desktop'; ip: string }

export type ActorAdmissionResult = { outcome: 'admitted' } | { outcome: 'rate-limited'; retryAfterSeconds: number }

export type SourceDomain = 'brawlhalla-v0' | 'brawlhalla-v1'

export type SourceAdmissionResult =
  | { outcome: 'admitted'; deduplicated: boolean }
  | { outcome: 'rate-limited'; retryAfterSeconds: number }

export interface ActorAdmission {
  admitActor(actor: RefreshActor, reservationKey?: string): Promise<ActorAdmissionResult>
  hasActorReservation(reservationKey: string): Promise<boolean>
}

export interface SourceAdmission {
  admitSource(input: {
    domain: SourceDomain
    reservationKey: string
    units: number
  }): Promise<SourceAdmissionResult>
}
