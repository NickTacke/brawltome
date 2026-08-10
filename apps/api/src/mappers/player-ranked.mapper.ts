import { type PlayerRankedProfileContract, parsePlayerRankedProfileOutput } from '@brawltome/contracts'
import type { RankedPlayerProfile } from '@brawltome/player'

export function mapPlayerRankedProfile(profile: RankedPlayerProfile | null): PlayerRankedProfileContract | null {
  if (!profile) return null
  return parsePlayerRankedProfileOutput({
    ...profile,
    checkedAt: profile.checkedAt.toISOString(),
    lastSuccessAt: profile.lastSuccessAt?.toISOString() ?? null,
    sparsePulse: profile.sparsePulse
      ? {
          checkedAt: profile.sparsePulse.checkedAt.toISOString(),
          lastSuccessAt: profile.sparsePulse.lastSuccessAt?.toISOString() ?? null,
        }
      : null,
    snapshot: profile.snapshot
      ? {
          ...profile.snapshot,
          ratingHistory: profile.snapshot.ratingHistory.map((point) => ({
            ...point,
            recordedAt: point.recordedAt.toISOString(),
          })),
          observedRatingDirection: profile.snapshot.observedRatingDirection
            ? {
                ...profile.snapshot.observedRatingDirection,
                fromObservedAt: profile.snapshot.observedRatingDirection.fromObservedAt.toISOString(),
                toObservedAt: profile.snapshot.observedRatingDirection.toObservedAt.toISOString(),
              }
            : null,
        }
      : null,
  })
}
