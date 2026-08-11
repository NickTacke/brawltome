import { type LaunchCohortBracket, type LaunchCohortRegion, launchCohortBrackets, launchCohortRegions } from './cohort'

export const LEGEND_META_METHODOLOGY_VERSION = 'current-season-legend-meta-v1'
export const LEGEND_META_MINIMUM_PLAYERS = 30
export const LEGEND_META_MINIMUM_GAMES = 200
export const LEGEND_META_PUBLICATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000
const LEGEND_META_FORMULAS = {
  pickShare: 'Observed legend games divided by all observed legend games in the selected filter.',
  adoption:
    'Observed players with games on the legend divided by players with a successful ranked observation in the selected filter.',
  winRate: 'Observed legend wins divided by observed legend games, weighted by games.',
  medianRating: 'Median current 1v1 player rating among observed players with games on the legend.',
  coverage: 'Successful ranked observations divided by selected Observed Cohort players.',
  uncertainty: '95% Wilson score interval over observed legend wins and games.',
} as const

const LEGEND_META_ELIGIBILITY = {
  minimumPlayers: LEGEND_META_MINIMUM_PLAYERS,
  minimumGames: LEGEND_META_MINIMUM_GAMES,
  rule: 'A row needs both minimums to receive a comparative rank.',
} as const

const LEGEND_META_COMMON_CAVEATS = [
  'BrawlTome-observed values are not exhaustive or live.',
  'Missing source observations reduce coverage and are not counted as zero games.',
] as const

export const LEGEND_META_METHODOLOGY_DISCLOSURE = {
  population: 'deterministic-observed-cohort',
  seasonalScope: 'Cumulative current-season ranked 1v1 values observed during the collection window.',
  formulas: LEGEND_META_FORMULAS,
  eligibility: LEGEND_META_ELIGIBILITY,
  trends: {
    status: 'disabled',
    reason: 'season-identity-unavailable',
  },
  caveats: [
    ...LEGEND_META_COMMON_CAVEATS,
    'The source does not expose a stable season identity, so cross-publication trends are unavailable.',
    'Observed win rate describes this cohort and does not establish legend strength or causation.',
  ],
} as const

export const LEGEND_META_CONDITIONAL_TREND_METHODOLOGY_DISCLOSURE = {
  population: 'deterministic-observed-cohort',
  seasonalScope: 'Cumulative current-season ranked 1v1 values observed during the collection window.',
  formulas: LEGEND_META_FORMULAS,
  eligibility: LEGEND_META_ELIGIBILITY,
  trends: {
    status: 'conditional',
    requirement:
      'Adjacent snapshots require the same authoritative season, cohort methodology, metric methodology, and scope.',
  },
  caveats: [
    ...LEGEND_META_COMMON_CAVEATS,
    'Cross-publication trends stop at the first incompatible adjacent snapshot.',
    'Observed win rate describes this cohort and does not establish legend strength or causation.',
  ],
} as const

const WILSON_95_Z = 1.959963984540054
const BASIS_POINTS = 10_000

export class LegendMetaBuildError extends Error {
  constructor(
    readonly code: 'duplicate-player-across-cells' | 'unknown-legend',
    readonly legendId: number | null = null,
  ) {
    super(code === 'unknown-legend' ? `unknown legend ${legendId}` : 'duplicate player across launch cells')
    this.name = 'LegendMetaBuildError'
  }
}

export type LegendMetaLegend = {
  legendId: number
  name: string
  slug: string
}

export type LegendMetaObservedPlayer = {
  brawlhallaId: number
  rating: number
  legends: Array<{ legendId: number; games: number; wins: number }>
}

export type ExactRatio = {
  numerator: number
  denominator: number
  basisPoints: number | null
}

export type WilsonInterval = {
  lowerBasisPoints: number
  upperBasisPoints: number
}

export type LegendMetaRow = {
  legend: LegendMetaLegend
  playerCount: number
  gameCount: number
  winCount: number
  medianRating: number | null
  pickShare: ExactRatio
  adoption: ExactRatio
  winRate: ExactRatio
  uncertainty95: WilsonInterval | null
  eligible: boolean
  rank: number | null
}

export type LegendMetaSlice = {
  selectedPlayers: number
  observedPlayers: number
  observedLegendGames: number
  coverage: ExactRatio
  rows: LegendMetaRow[]
}

export type LegendMetaFilterRegion = 'all' | LaunchCohortRegion
export type LegendMetaFilterBracket = 'all' | LaunchCohortBracket

export type LegendMetaArtifactSlice = LegendMetaSlice & {
  region: LegendMetaFilterRegion
  bracket: LegendMetaFilterBracket
}

export type LegendMetaArtifact = {
  snapshotId: string
  generationId: string
  methodologyVersion: typeof LEGEND_META_METHODOLOGY_VERSION
  cohortMethodologyVersion: string
  sourceGenerationId: string
  sourceObservedAt: string
  observationWindow: { startsAt: string; endsAt: string }
  publishedAt: string
  expectedNextPublicationAt: string
  season: {
    scope: 'current-season'
    identity: string | null
    source: 'brawlhalla-v1-ranked-1v1'
  }
  methodology: typeof LEGEND_META_METHODOLOGY_DISCLOSURE | typeof LEGEND_META_CONDITIONAL_TREND_METHODOLOGY_DISCLOSURE
  slices: LegendMetaArtifactSlice[]
}

export type LegendMetaCell = {
  region: LaunchCohortRegion
  bracket: LaunchCohortBracket
  selectedPlayers: number
  observations: readonly LegendMetaObservedPlayer[]
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`)
  return value
}

function positiveInteger(value: number, name: string): number {
  const result = nonnegativeInteger(value, name)
  if (result === 0) throw new Error(`${name} must be positive`)
  return result
}

function checkedAdd(left: number, right: number, name: string): number {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw new Error(`${name} exceeds safe integer precision`)
  return result
}

function exactRatio(numerator: number, denominator: number): ExactRatio {
  return {
    numerator,
    denominator,
    basisPoints: denominator === 0 ? null : Math.round((numerator * BASIS_POINTS) / denominator),
  }
}

function utcTimestamp(value: string, name: string): number {
  if (!value.endsWith('Z')) throw new Error(`${name} must be a UTC timestamp`)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid timestamp`)
  return timestamp
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  if (ordered.length % 2 === 1) return ordered[middle] ?? null
  return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
}

export function wilsonInterval95(wins: number, games: number): WilsonInterval | null {
  nonnegativeInteger(wins, 'wins')
  nonnegativeInteger(games, 'games')
  if (wins > games) throw new Error('wins cannot exceed games')
  if (games === 0) return null

  const probability = wins / games
  const zSquared = WILSON_95_Z * WILSON_95_Z
  const denominator = 1 + zSquared / games
  const center = (probability + zSquared / (2 * games)) / denominator
  const margin =
    (WILSON_95_Z * Math.sqrt((probability * (1 - probability) + zSquared / (4 * games)) / games)) / denominator

  return {
    lowerBasisPoints: Math.max(0, Math.floor((center - margin) * BASIS_POINTS)),
    upperBasisPoints: Math.min(BASIS_POINTS, Math.ceil((center + margin) * BASIS_POINTS)),
  }
}

export function aggregateLegendMetaSlice(input: {
  legends: readonly LegendMetaLegend[]
  selectedPlayers: number
  observations: readonly LegendMetaObservedPlayer[]
}): LegendMetaSlice {
  const selectedPlayers = nonnegativeInteger(input.selectedPlayers, 'selectedPlayers')
  if (input.observations.length > selectedPlayers) throw new Error('observed players cannot exceed selected players')

  const legendById = new Map<number, LegendMetaLegend>()
  for (const legend of input.legends) {
    positiveInteger(legend.legendId, 'legendId')
    if (!legend.name || !legend.slug) throw new Error('legend reference requires a name and slug')
    if (legendById.has(legend.legendId)) throw new Error(`duplicate legend reference ${legend.legendId}`)
    legendById.set(legend.legendId, legend)
  }

  const observedPlayerIds = new Set<number>()
  const aggregates = new Map<number, { players: number; games: number; wins: number; ratings: number[] }>(
    input.legends.map(({ legendId }) => [legendId, { players: 0, games: 0, wins: 0, ratings: [] }]),
  )
  let observedLegendGames = 0

  for (const observation of input.observations) {
    positiveInteger(observation.brawlhallaId, 'brawlhallaId')
    nonnegativeInteger(observation.rating, 'rating')
    if (observedPlayerIds.has(observation.brawlhallaId)) {
      throw new Error(`duplicate observed player ${observation.brawlhallaId}`)
    }
    observedPlayerIds.add(observation.brawlhallaId)
    const observedLegendIds = new Set<number>()
    for (const observedLegend of observation.legends) {
      positiveInteger(observedLegend.legendId, 'observed legend ID')
      const aggregate = aggregates.get(observedLegend.legendId)
      if (!aggregate || !legendById.has(observedLegend.legendId)) {
        throw new LegendMetaBuildError('unknown-legend', observedLegend.legendId)
      }
      if (observedLegendIds.has(observedLegend.legendId)) {
        throw new Error(`duplicate observed legend ${observedLegend.legendId}`)
      }
      observedLegendIds.add(observedLegend.legendId)
      nonnegativeInteger(observedLegend.games, 'legend games')
      nonnegativeInteger(observedLegend.wins, 'legend wins')
      if (observedLegend.wins > observedLegend.games) throw new Error('wins cannot exceed games')
      aggregate.games = checkedAdd(aggregate.games, observedLegend.games, 'legend games')
      aggregate.wins = checkedAdd(aggregate.wins, observedLegend.wins, 'legend wins')
      observedLegendGames = checkedAdd(observedLegendGames, observedLegend.games, 'observed legend games')
      if (observedLegend.games > 0) {
        aggregate.players++
        aggregate.ratings.push(observation.rating)
      }
    }
  }

  const rows = input.legends.map((legend): LegendMetaRow => {
    const aggregate = aggregates.get(legend.legendId)
    if (!aggregate) throw new Error(`legend aggregate ${legend.legendId} disappeared`)
    const eligible = aggregate.players >= LEGEND_META_MINIMUM_PLAYERS && aggregate.games >= LEGEND_META_MINIMUM_GAMES
    return {
      legend,
      playerCount: aggregate.players,
      gameCount: aggregate.games,
      winCount: aggregate.wins,
      medianRating: median(aggregate.ratings),
      pickShare: exactRatio(aggregate.games, observedLegendGames),
      adoption: exactRatio(aggregate.players, input.observations.length),
      winRate: exactRatio(aggregate.wins, aggregate.games),
      uncertainty95: wilsonInterval95(aggregate.wins, aggregate.games),
      eligible,
      rank: null,
    }
  })

  const eligibleRows = rows.filter(({ eligible }) => eligible)
  eligibleRows.sort((left, right) => {
    const exactComparison =
      BigInt(right.pickShare.numerator) * BigInt(left.pickShare.denominator) -
      BigInt(left.pickShare.numerator) * BigInt(right.pickShare.denominator)
    if (exactComparison !== 0n) return exactComparison > 0n ? 1 : -1
    return left.legend.legendId - right.legend.legendId
  })
  for (const [index, row] of eligibleRows.entries()) {
    const previous = eligibleRows[index - 1]
    row.rank =
      previous &&
      BigInt(previous.pickShare.numerator) * BigInt(row.pickShare.denominator) ===
        BigInt(row.pickShare.numerator) * BigInt(previous.pickShare.denominator)
        ? previous.rank
        : index + 1
  }

  return {
    selectedPlayers,
    observedPlayers: input.observations.length,
    observedLegendGames,
    coverage: exactRatio(input.observations.length, selectedPlayers),
    rows: [...eligibleRows, ...rows.filter(({ eligible }) => !eligible)],
  }
}

export function buildLegendMetaArtifact(input: {
  snapshotId: string
  generationId: string
  cohortMethodologyVersion: string
  sourceGenerationId: string
  sourceObservedAt: string
  observationWindow: { startsAt: string; endsAt: string }
  publishedAt: string
  seasonIdentity?: string | null
  legends: readonly LegendMetaLegend[]
  cells: readonly LegendMetaCell[]
}): LegendMetaArtifact {
  if (input.cells.length !== launchCohortRegions.length * launchCohortBrackets.length) {
    throw new Error('Legend Meta requires exactly 18 launch cells')
  }
  const cellsByKey = new Map<string, LegendMetaCell>()
  const observedAcrossCells = new Set<number>()
  for (const cell of input.cells) {
    const key = `${cell.region}:${cell.bracket}`
    if (cellsByKey.has(key)) throw new Error('Legend Meta requires exactly one row per launch cell')
    cellsByKey.set(key, cell)
    for (const observation of cell.observations) {
      if (observedAcrossCells.has(observation.brawlhallaId)) {
        throw new LegendMetaBuildError('duplicate-player-across-cells')
      }
      observedAcrossCells.add(observation.brawlhallaId)
    }
  }
  for (const region of launchCohortRegions) {
    for (const bracket of launchCohortBrackets) {
      if (!cellsByKey.has(`${region}:${bracket}`)) {
        throw new Error(`missing Legend Meta launch cell ${region}/${bracket}`)
      }
    }
  }

  utcTimestamp(input.sourceObservedAt, 'source observed time')
  const startsAt = utcTimestamp(input.observationWindow.startsAt, 'observation window start')
  const endsAt = utcTimestamp(input.observationWindow.endsAt, 'observation window end')
  const publishedAt = utcTimestamp(input.publishedAt, 'publication time')
  if (endsAt <= startsAt) throw new Error('observation window end must follow its start')
  const seasonIdentity = input.seasonIdentity ?? null
  if (seasonIdentity !== null && (seasonIdentity.length < 1 || seasonIdentity.length > 200)) {
    throw new Error('season identity must contain between 1 and 200 characters')
  }

  const regions: LegendMetaFilterRegion[] = ['all', ...launchCohortRegions]
  const brackets: LegendMetaFilterBracket[] = ['all', ...launchCohortBrackets]
  const slices = regions.flatMap((region) =>
    brackets.map((bracket): LegendMetaArtifactSlice => {
      const included = input.cells.filter(
        (cell) => (region === 'all' || cell.region === region) && (bracket === 'all' || cell.bracket === bracket),
      )
      const aggregated = aggregateLegendMetaSlice({
        legends: input.legends,
        selectedPlayers: included.reduce(
          (total, cell) => checkedAdd(total, cell.selectedPlayers, 'selected players'),
          0,
        ),
        observations: included.flatMap((cell) => cell.observations),
      })
      return { region, bracket, ...aggregated }
    }),
  )

  return {
    snapshotId: input.snapshotId,
    generationId: input.generationId,
    methodologyVersion: LEGEND_META_METHODOLOGY_VERSION,
    cohortMethodologyVersion: input.cohortMethodologyVersion,
    sourceGenerationId: input.sourceGenerationId,
    sourceObservedAt: input.sourceObservedAt,
    observationWindow: input.observationWindow,
    publishedAt: input.publishedAt,
    expectedNextPublicationAt: new Date(publishedAt + LEGEND_META_PUBLICATION_INTERVAL_MS).toISOString(),
    season: {
      scope: 'current-season',
      identity: seasonIdentity,
      source: 'brawlhalla-v1-ranked-1v1',
    },
    methodology:
      seasonIdentity === null
        ? LEGEND_META_METHODOLOGY_DISCLOSURE
        : LEGEND_META_CONDITIONAL_TREND_METHODOLOGY_DISCLOSURE,
    slices,
  }
}
