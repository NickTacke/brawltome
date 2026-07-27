import type { BhV1PlayerGuild, BhV1PlayerStatsAll, BhV1PlayerStatsRanked, BhV1PlayerTeams, V1Mode } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireNumber(record: Record<string, unknown>, key: string, context: string): void {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
    throw new Error(`Invalid ${context}: ${key} must be a finite number`)
  }
}

function requireString(record: Record<string, unknown>, key: string, context: string): void {
  if (typeof record[key] !== 'string') {
    throw new Error(`Invalid ${context}: ${key} must be a string`)
  }
}

function validateLegend(legend: unknown, mode: V1Mode, index: number): void {
  const context = `player stats legend ${index} for mode ${mode}`
  if (!isRecord(legend)) throw new Error(`Invalid ${context}: expected an object`)

  for (const key of ['legend_id', 'games', 'wins']) requireNumber(legend, key, context)

  if (mode !== 'all') {
    for (const key of ['rating', 'peak_rating']) requireNumber(legend, key, context)
    requireString(legend, 'tier', context)
  }
}

export function validatePlayerGuild(payload: unknown, expectedPlayerId: number): BhV1PlayerGuild {
  const context = 'player guild payload'
  if (!isRecord(payload)) throw new Error(`Invalid ${context}: expected an object`)
  if (payload.brawlhalla_id !== expectedPlayerId) {
    throw new Error(`Invalid ${context}: unexpected player ID`)
  }
  if (!isRecord(payload.guild)) throw new Error(`Invalid ${context}: guild must be an object`)

  for (const key of ['guild_id', 'personal_xp']) requireNumber(payload.guild, key, context)

  return payload as unknown as BhV1PlayerGuild
}

export function validatePlayerTeams(payload: unknown, expectedPlayerId: number): BhV1PlayerTeams {
  const context = 'player teams payload'
  if (!isRecord(payload)) throw new Error(`Invalid ${context}: expected an object`)
  if (payload.brawlhalla_id !== expectedPlayerId) {
    throw new Error(`Invalid ${context}: unexpected player ID`)
  }
  if (!isRecord(payload.teams) || !Array.isArray(payload.teams.ranked_2v2)) {
    throw new Error(`Invalid ${context}: ranked_2v2 must be an array`)
  }

  payload.teams.ranked_2v2.forEach((team, index) => {
    const teamContext = `${context} team ${index}`
    if (!isRecord(team)) throw new Error(`Invalid ${teamContext}: expected an object`)
    for (const key of ['brawlhalla_id_one', 'brawlhalla_id_two', 'rating', 'peak_rating', 'wins', 'games']) {
      requireNumber(team, key, teamContext)
    }
    for (const key of ['username_one', 'username_two', 'tier', 'region']) {
      requireString(team, key, teamContext)
    }
  })

  return payload as unknown as BhV1PlayerTeams
}

export function validatePlayerStats(
  payload: unknown,
  expectedPlayerId: number,
  mode: V1Mode,
): BhV1PlayerStatsAll | BhV1PlayerStatsRanked {
  const context = `player stats payload for mode ${mode}`
  if (!isRecord(payload)) throw new Error(`Invalid ${context}: expected an object`)

  if (payload.brawlhalla_id !== expectedPlayerId) {
    throw new Error(`Invalid ${context}: unexpected player ID`)
  }

  requireString(payload, 'name', context)
  for (const key of ['games', 'wins']) requireNumber(payload, key, context)

  if (!Array.isArray(payload.legends)) {
    throw new Error(`Invalid ${context}: legends must be an array`)
  }
  payload.legends.forEach((legend, index) => validateLegend(legend, mode, index))

  if (mode !== 'all') {
    for (const key of ['rating', 'peak_rating']) requireNumber(payload, key, context)
    for (const key of ['tier', 'region']) requireString(payload, key, context)
  }

  return payload as unknown as BhV1PlayerStatsAll | BhV1PlayerStatsRanked
}
