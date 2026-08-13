import type { ClanProfileContract } from '@brawltome/contracts'

export type PendingClanSections = { profile: boolean; roster: boolean }

const CLAN_TTL_MS = 60 * 60 * 1_000

function stale(value: string | null | undefined, now: number): boolean {
  if (!value) return true
  const timestamp = new Date(value).getTime()
  return !Number.isFinite(timestamp) || now - timestamp > CLAN_TTL_MS
}

export function getPendingClanSections(clan: ClanProfileContract | null, now = Date.now()): PendingClanSections {
  return {
    profile: stale(clan?.profile.lastSuccessAt, now),
    roster: stale(clan?.roster?.lastSuccessAt, now),
  }
}

export function hasCompletedClanRefresh(
  initial: ClanProfileContract | null,
  next: ClanProfileContract | null,
  pending: PendingClanSections,
): boolean {
  if (!next) return false
  return (
    (!pending.profile ||
      (!!next.profile.lastSuccessAt && next.profile.lastSuccessAt !== initial?.profile.lastSuccessAt)) &&
    (!pending.roster || (!!next.roster?.lastSuccessAt && next.roster.lastSuccessAt !== initial?.roster?.lastSuccessAt))
  )
}
