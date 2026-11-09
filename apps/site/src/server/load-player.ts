import {
  nullablePlayerCareerProfileSchema,
  nullablePlayerRankedProfileSchema,
  nullablePlayerReferenceSchema,
  nullablePlayerValhallanEvidenceSchema,
  type PlayerCareerProfileContract,
  type PlayerRankedProfileContract,
  type PlayerReferenceContract,
  playerClanMembershipSchema,
  type SeasonStartContract,
  seasonStartsSchema,
} from '@brawltome/contracts'
import type { z } from 'zod'
import { readApi } from './api'
import { withOfficialValhallanTier } from './official-tier'
import { failureText, optionalRead, readOptional } from './optional-read'

type PlayerClanMembership = z.infer<typeof playerClanMembershipSchema>

export type PlayerData = {
  brawlhallaId: number
  name: string
  aliases: string[]
  clan: PlayerClanMembership | null
  bestLegendNameKey: string | null
  currentSeason: PlayerRankedProfileContract | null
  career: PlayerCareerProfileContract | null
}

export type PlayerPage = {
  player: PlayerData
  seasonStarts: SeasonStartContract[]
  // one clock for anything that depends on the time, so the server render and hydration can't disagree
  loadedAt: string
}

type RequiredParts = [
  PlayerReferenceContract | null,
  PlayerRankedProfileContract | null,
  PlayerCareerProfileContract | null,
]

// thrown messages reach the page's html, so the detail only goes to the server log
async function readRequiredParts(playerId: number): Promise<RequiredParts> {
  const description = `load player ${playerId}`

  try {
    return await Promise.all([
      readApi(`/players/${playerId}/reference`, nullablePlayerReferenceSchema, description),
      readApi(`/players/${playerId}/ranked`, nullablePlayerRankedProfileSchema, description),
      readApi(`/players/${playerId}/career`, nullablePlayerCareerProfileSchema, description),
    ])
  } catch (error) {
    console.error(failureText(error))

    throw new Error(`load player ${playerId}: the player could not be read`)
  }
}

function readClan(playerId: number) {
  const read = () =>
    readApi(
      `/players/${playerId}/clan`,
      playerClanMembershipSchema.nullable(),
      `load guild of player ${playerId}`,
      optionalRead,
    )

  return readOptional(read, null)
}

function readValhallanEvidence(playerId: number) {
  const description = `load valhallan evidence for player ${playerId}`
  const path = `/players/${playerId}/valhallan-evidence`

  return readOptional(() => readApi(path, nullablePlayerValhallanEvidenceSchema, description, optionalRead), null)
}

function readSeasonStarts() {
  return readOptional(() => readApi('/seasons', seasonStartsSchema, 'load season starts', optionalRead), [])
}

export async function loadPlayer(playerId: number): Promise<PlayerPage | null> {
  const [[reference, ranked, career], clan, evidence, seasonStarts] = await Promise.all([
    readRequiredParts(playerId),
    readClan(playerId),
    readValhallanEvidence(playerId),
    readSeasonStarts(),
  ])

  if (!reference) return null

  const player: PlayerData = {
    brawlhallaId: reference.brawlhallaId,
    name: reference.name,
    aliases: reference.aliases,
    clan,
    bestLegendNameKey: reference.bestLegendNameKey ?? null,
    currentSeason: withOfficialValhallanTier(ranked, evidence),
    career,
  }

  return { player, seasonStarts, loadedAt: new Date().toISOString() }
}
