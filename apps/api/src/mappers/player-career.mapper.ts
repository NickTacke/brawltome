import { type PlayerCareerProfileContract, parsePlayerCareerProfileOutput } from '@brawltome/contracts'
import type { CareerPlayerProfile } from '@brawltome/player'

export function mapPlayerCareerProfile(profile: CareerPlayerProfile | null): PlayerCareerProfileContract | null {
  if (!profile) return null
  return parsePlayerCareerProfileOutput({
    ...profile,
    checkedAt: profile.checkedAt.toISOString(),
    lastSuccessAt: profile.lastSuccessAt?.toISOString() ?? null,
  })
}
