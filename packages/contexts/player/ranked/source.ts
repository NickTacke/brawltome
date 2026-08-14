const REGION_BY_ID = {
  2: 'US-E',
  3: 'EU',
  4: 'SEA',
  5: 'BRZ',
  6: 'AUS',
  7: 'US-W',
  8: 'JPN',
  9: 'ME',
  10: 'SA',
} as const

const PLAYER_REGIONS = new Set(Object.values(REGION_BY_ID))
const INT32_MAX = 2_147_483_647

type RecordValue = Record<string, unknown>

export type RankedValues = {
  rating: number
  peakRating: number
  tier: string
  wins: number
  games: number
}

export type RankedPulseValues = Partial<Pick<RankedValues, 'rating' | 'peakRating' | 'wins' | 'games'>>

export type V1FixedTeamPulse = {
  brawlhallaIdOne: number
  brawlhallaIdTwo: number
  values: RankedPulseValues
}

export type V1RankedPulse = {
  brawlhallaId: number
  oneVsOne: RankedPulseValues | null
  fixedTeams: V1FixedTeamPulse[]
}

export type V0RankedSnapshot = {
  brawlhallaId: number
  name: string | null
  oneVsOne: RankedValues & {
    region: string
    globalRank: number | null
    regionRank: number | null
  }
  rankedLegends: Array<
    RankedValues & {
      legendId: number
      legendNameKey: string
    }
  >
  rankedMainLegend: { legendId: number; legendNameKey: string } | null
  fixedTeams: Array<
    RankedValues & {
      brawlhallaIdOne: number
      brawlhallaIdTwo: number
      teamName: string
      region: string
      globalRank: number | null
    }
  >
  soloQueue: Array<
    RankedValues & {
      secondPlayerId: 0
      teamName: string
      region: string
      globalRank: number | null
    }
  >
}

function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as RecordValue
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > INT32_MAX) {
    throw new Error(`${path} must be an integer between ${minimum} and ${INT32_MAX}`)
  }
  return value as number
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`)
  return value
}

function text(value: unknown, path: string): string {
  const result = stringValue(value, path)
  if (result.length === 0 || !/[^\p{Separator}\p{Format}]/u.test(result)) {
    throw new Error(`${path} must contain visible text`)
  }
  return result
}

function placement(value: unknown, path: string): number | null {
  const rank = integer(value, path)
  return rank > 0 ? rank : null
}

function rankedValues(value: RecordValue, path: string): RankedValues {
  return {
    rating: integer(value.rating, `${path}.rating`),
    peakRating: integer(value.peak_rating, `${path}.peak_rating`),
    tier: text(value.tier, `${path}.tier`),
    wins: integer(value.wins, `${path}.wins`),
    games: integer(value.games, `${path}.games`),
  }
}

function rankedPulseValues(value: RecordValue, path: string): RankedPulseValues {
  const result: RankedPulseValues = {}
  if (value.rating !== undefined) result.rating = integer(value.rating, `${path}.rating`)
  if (value.peak_rating !== undefined) result.peakRating = integer(value.peak_rating, `${path}.peak_rating`)
  if (value.wins !== undefined) result.wins = integer(value.wins, `${path}.wins`)
  if (value.games !== undefined) result.games = integer(value.games, `${path}.games`)
  return result
}

export function decodeV1OneVsOnePulse(payload: unknown, requestedBrawlhallaId: number): RankedPulseValues | null {
  const source = record(payload, 'ranked pulse')
  const brawlhallaId = integer(source.brawlhalla_id, 'ranked pulse.brawlhalla_id', 1)
  if (brawlhallaId !== requestedBrawlhallaId) {
    throw new Error('ranked pulse.brawlhalla_id does not match the requested player')
  }
  const values = rankedPulseValues(source, 'ranked pulse')
  return Object.keys(values).length > 0 ? values : null
}

export function decodeV1FixedTeamPulses(payload: unknown, requestedBrawlhallaId: number): V1FixedTeamPulse[] {
  if (payload === null) return []
  const source = record(payload, 'ranked team pulse')
  const brawlhallaId = integer(source.brawlhalla_id, 'ranked team pulse.brawlhalla_id', 1)
  if (brawlhallaId !== requestedBrawlhallaId) {
    throw new Error('ranked team pulse.brawlhalla_id does not match the requested player')
  }
  if (source.teams === undefined) return []
  const teams = record(source.teams, 'ranked team pulse.teams')
  if (teams.ranked_2v2 === undefined) return []

  const seen = new Set<string>()
  const pulses: V1FixedTeamPulse[] = []
  for (const [index, value] of array(teams.ranked_2v2, 'ranked team pulse.teams.ranked_2v2').entries()) {
    const path = `ranked team pulse.teams.ranked_2v2[${index}]`
    const team = record(value, path)
    const first = integer(team.brawlhalla_id_one, `${path}.brawlhalla_id_one`, 1)
    const second = integer(team.brawlhalla_id_two, `${path}.brawlhalla_id_two`)
    if (second === 0) {
      if (first !== brawlhallaId) throw new Error(`${path} Solo Queue owner must be the first player`)
      continue
    }
    if (first !== brawlhallaId && second !== brawlhallaId) {
      throw new Error(`${path} does not contain the requested player`)
    }
    const brawlhallaIdOne = Math.min(first, second)
    const brawlhallaIdTwo = Math.max(first, second)
    const key = `${brawlhallaIdOne}:${brawlhallaIdTwo}`
    if (seen.has(key)) throw new Error(`ranked team pulse contains duplicate fixed team ${key}`)
    seen.add(key)
    const values = rankedPulseValues(team, path)
    if (Object.keys(values).length > 0) pulses.push({ brawlhallaIdOne, brawlhallaIdTwo, values })
  }
  return pulses
}

function playerRegion(value: unknown, path: string): string {
  const region = text(value, path)
  if (region === 'none') return ''
  if (!PLAYER_REGIONS.has(region as (typeof REGION_BY_ID)[keyof typeof REGION_BY_ID])) {
    throw new Error(`${path} is not a supported ranked region`)
  }
  return region
}

function teamRegion(value: unknown, path: string): string {
  const regionId = integer(value, path)
  const region = REGION_BY_ID[regionId as keyof typeof REGION_BY_ID]
  if (!region) throw new Error(`${path} is not a proven V0 ranked region`)
  return region
}

export function decodeV0RankedSnapshot(payload: unknown, requestedBrawlhallaId: number): V0RankedSnapshot {
  const source = record(payload, 'ranked')
  const brawlhallaId = integer(source.brawlhalla_id, 'ranked.brawlhalla_id', 1)
  if (brawlhallaId !== requestedBrawlhallaId)
    throw new Error('ranked.brawlhalla_id does not match the requested player')

  const legendIds = new Set<number>()
  const rankedLegends = array(source.legends, 'ranked.legends').map((value, index) => {
    const legend = record(value, `ranked.legends[${index}]`)
    const legendId = integer(legend.legend_id, `ranked.legends[${index}].legend_id`, 1)
    if (legendIds.has(legendId)) throw new Error(`ranked.legends contains duplicate legend ${legendId}`)
    legendIds.add(legendId)
    return {
      legendId,
      legendNameKey: text(legend.legend_name_key, `ranked.legends[${index}].legend_name_key`),
      ...rankedValues(legend, `ranked.legends[${index}]`),
    }
  })

  let rankedMainLegend: V0RankedSnapshot['rankedMainLegend'] = null
  let mostGames = 0
  for (const legend of rankedLegends) {
    if (legend.games > mostGames) {
      rankedMainLegend = { legendId: legend.legendId, legendNameKey: legend.legendNameKey }
      mostGames = legend.games
    }
  }

  const fixedTeams: V0RankedSnapshot['fixedTeams'] = []
  const soloQueue: V0RankedSnapshot['soloQueue'] = []
  const teamKeys = new Set<string>()
  for (const [index, value] of array(source['2v2'], 'ranked.2v2').entries()) {
    const team = record(value, `ranked.2v2[${index}]`)
    const brawlhallaIdOne = integer(team.brawlhalla_id_one, `ranked.2v2[${index}].brawlhalla_id_one`, 1)
    const brawlhallaIdTwo = integer(team.brawlhalla_id_two, `ranked.2v2[${index}].brawlhalla_id_two`)
    if (brawlhallaIdOne === brawlhallaId && brawlhallaIdTwo === brawlhallaId) continue
    const key =
      brawlhallaIdTwo === 0
        ? `solo:${index}`
        : `fixed:${Math.min(brawlhallaIdOne, brawlhallaIdTwo)}:${Math.max(brawlhallaIdOne, brawlhallaIdTwo)}`
    if (teamKeys.has(key)) throw new Error(`ranked.2v2 contains duplicate team ${key}`)
    teamKeys.add(key)

    const teamName = stringValue(team.teamname, `ranked.2v2[${index}].teamname`)
    const mapped = {
      ...rankedValues(team, `ranked.2v2[${index}]`),
      region: teamRegion(team.region, `ranked.2v2[${index}].region`),
      globalRank: placement(team.global_rank, `ranked.2v2[${index}].global_rank`),
    }
    if (brawlhallaIdTwo === 0) {
      if (brawlhallaIdOne !== brawlhallaId) throw new Error('ranked Solo Queue owner must be the first player')
      soloQueue.push({ secondPlayerId: 0, teamName, ...mapped })
      continue
    }
    if (brawlhallaIdOne !== brawlhallaId && brawlhallaIdTwo !== brawlhallaId) {
      throw new Error('ranked fixed team does not contain the requested player')
    }
    fixedTeams.push({
      brawlhallaIdOne,
      brawlhallaIdTwo,
      teamName,
      ...mapped,
    })
  }

  return {
    brawlhallaId,
    name: typeof source.name === 'string' && /[^\p{Separator}\p{Format}]/u.test(source.name) ? source.name : null,
    oneVsOne: {
      ...rankedValues(source, 'ranked'),
      region: playerRegion(source.region, 'ranked.region'),
      globalRank: placement(source.global_rank, 'ranked.global_rank'),
      regionRank: placement(source.region_rank, 'ranked.region_rank'),
    },
    rankedLegends,
    rankedMainLegend,
    fixedTeams,
    soloQueue,
  }
}
