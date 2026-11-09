import { type PlayerCareerProfileContract, parsePlayerCareerProfileOutput } from '@brawltome/contracts'
import type { CareerPlayerProfile } from '../career/model'

export function mapPlayerCareerProfile(profile: CareerPlayerProfile | null): PlayerCareerProfileContract | null {
  if (!profile) return null

  return parsePlayerCareerProfileOutput({
    ...profile,
    checkedAt: profile.checkedAt.toISOString(),
    lastSuccessAt: profile.lastSuccessAt?.toISOString() ?? null,
  })
}
