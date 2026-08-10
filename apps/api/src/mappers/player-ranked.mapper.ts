import { type PlayerRankedProfileContract, parsePlayerRankedProfileOutput } from '@brawltome/contracts'
import type { RankedPlayerProfile } from '@brawltome/player'

export function mapPlayerRankedProfile(profile: RankedPlayerProfile | null): PlayerRankedProfileContract | null {
  if (!profile) return null
  return parsePlayerRankedProfileOutput({
    ...profile,
    checkedAt: profile.checkedAt.toISOString(),
    lastSuccessAt: profile.lastSuccessAt?.toISOString() ?? null,
    snapshot: profile.snapshot
      ? {
          ...profile.snapshot,
          ratingHistory: profile.snapshot.ratingHistory.map((point) => ({
            ...point,
            recordedAt: point.recordedAt.toISOString(),
          })),
        }
      : null,
  })
}
