export const regionalLeaderboardScopes = ['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'] as const
export type RegionalLeaderboardScope = (typeof regionalLeaderboardScopes)[number]

export const leaderboardModes = ['1v1', '2v2', 'solo2v2', '3v3'] as const
export type LeaderboardMode = (typeof leaderboardModes)[number]

export type SourcePlayer = { id: number; username: string }
export type SourceLeaderboardIdentity =
  | { type: 'one-vs-one-player'; player: SourcePlayer }
  | { type: 'fixed-two-vs-two-team'; players: readonly [SourcePlayer, SourcePlayer] }
  | { type: 'solo-two-vs-two-player'; player: SourcePlayer }
  | { type: 'three-vs-three-player'; player: SourcePlayer }

export type SourceLeaderboardRow = {
  identity: SourceLeaderboardIdentity
  rating: number
  best_rating: number
  rank: number
  wins: number
  losses: number
  region: RegionalLeaderboardScope
  tier: string | null
}

export type SourceLeaderboardPage = {
  rankings: SourceLeaderboardRow[]
  totalPages: number
}

type SourceErrorCode = 'source_contract_invalid' | 'source_unavailable' | 'source_not_found' | 'source_transport_failed'

export class LeaderboardSourceError extends Error {
  constructor(
    public readonly code: SourceErrorCode,
    message: string,
    public readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LeaderboardSourceError'
  }
}

function invalid(message: string): never {
  throw new LeaderboardSourceError('source_contract_invalid', message, false)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredInteger(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > 2_147_483_647) {
    invalid(`${field} must be an integer between ${minimum} and 2147483647`)
  }
  return value as number
}

function requiredName(value: unknown, field: string): string {
  if (typeof value !== 'string' || [...value].length > 256 || !/[^\p{Separator}\p{Format}]/u.test(value)) {
    invalid(`${field} must contain between 1 and 256 visible Unicode characters`)
  }
  return value
}

function decodePlayer(value: unknown, field: string): SourcePlayer {
  if (!isObject(value)) invalid(`${field} must be an object`)
  return {
    id: requiredInteger(value.id, `${field}.id`, 1),
    username: requiredName(value.username, `${field}.username`),
  }
}

function decodeIdentity(value: unknown, mode: LeaderboardMode, index: number): SourceLeaderboardIdentity {
  if (!Array.isArray(value)) invalid(`rankings[${index}].players must be an array`)
  const expectedCount = mode === '2v2' ? 2 : 1
  if (value.length !== expectedCount) {
    invalid(
      `rankings[${index}].players must contain exactly ${expectedCount} player object${expectedCount === 1 ? '' : 's'}`,
    )
  }
  const players = value.map((entry, playerIndex) => decodePlayer(entry, `rankings[${index}].players[${playerIndex}]`))
  if (mode === '2v2') {
    const [first, second] = players
    if (!first || !second) invalid(`rankings[${index}].players must contain two players`)
    if (first.id === second.id) invalid(`rankings[${index}].players must contain distinct player IDs`)
    const canonical = first.id < second.id ? [first, second] : [second, first]
    return { type: 'fixed-two-vs-two-team', players: canonical as [SourcePlayer, SourcePlayer] }
  }
  const player = players[0]
  if (!player) invalid(`rankings[${index}].players must contain one player`)
  if (mode === '1v1') return { type: 'one-vs-one-player', player }
  if (mode === 'solo2v2') return { type: 'solo-two-vs-two-player', player }
  return { type: 'three-vs-three-player', player }
}

function decodeRow(value: unknown, mode: LeaderboardMode, index: number): SourceLeaderboardRow {
  if (!isObject(value)) invalid(`rankings[${index}] must be an object`)
  const region = value.region
  if (!regionalLeaderboardScopes.includes(region as RegionalLeaderboardScope)) {
    invalid(`rankings[${index}].region must be a supported region`)
  }
  const tier = value.tier
  if (tier !== undefined && tier !== null && (typeof tier !== 'string' || tier.length < 1 || tier.length > 100)) {
    invalid(`rankings[${index}].tier must be a non-empty bounded string when present`)
  }
  const rating = requiredInteger(value.rating, `rankings[${index}].rating`, 0)
  const bestRating = requiredInteger(value.best_rating, `rankings[${index}].best_rating`, 0)
  if (bestRating < rating) invalid(`rankings[${index}].best_rating cannot be below rating`)
  const wins = requiredInteger(value.wins, `rankings[${index}].wins`, 0)
  const losses = requiredInteger(value.losses, `rankings[${index}].losses`, 0)
  if (wins + losses > 2_147_483_647) invalid(`rankings[${index}] wins plus losses exceeds int32`)
  return {
    identity: decodeIdentity(value.players, mode, index),
    rating,
    best_rating: bestRating,
    rank: requiredInteger(value.rank, `rankings[${index}].rank`, 1),
    wins,
    losses,
    region: region as RegionalLeaderboardScope,
    tier: typeof tier === 'string' ? tier : null,
  }
}

export function decodeLeaderboardPage(
  value: unknown,
  expected: { mode: LeaderboardMode; region: RegionalLeaderboardScope; page: number },
): SourceLeaderboardPage {
  if (!leaderboardModes.includes(expected.mode)) invalid(`unsupported leaderboard mode ${expected.mode}`)
  if (!isObject(value)) invalid('leaderboard response must be an object')
  if (!Array.isArray(value.rankings)) invalid('rankings must be an array')
  if (value.rankings.length > 50) invalid('rankings cannot contain more than 50 rows')
  const totalPages = requiredInteger(value.total_pages, 'total_pages', 1)
  if (!Number.isSafeInteger(expected.page) || expected.page < 1 || expected.page > totalPages) {
    invalid(`requested page ${expected.page} exceeds total_pages ${totalPages}`)
  }
  return {
    rankings: value.rankings.map((row, index) => decodeRow(row, expected.mode, index)),
    totalPages,
  }
}

const sourceBase = 'https://api.brawlhalla.com/v1/leaderboard/ranked'
const sourceModes: Record<LeaderboardMode, string> = {
  '1v1': '1v1',
  '2v2': '2v2',
  solo2v2: 'solo_2v2',
  '3v3': '3v3',
}

function retryAfterSeconds(response: Response): number {
  const value = response.headers.get('retry-after') ?? ''
  const seconds = Number.parseInt(value, 10)
  if (Number.isFinite(seconds) && seconds > 0) return seconds + 1
  const dateMs = Date.parse(value)
  if (Number.isFinite(dateMs) && dateMs > Date.now()) return Math.ceil((dateMs - Date.now()) / 1_000) + 1
  return 6
}

export async function fetchLeaderboardPage(
  input: { mode: LeaderboardMode; region: RegionalLeaderboardScope; page: number },
  dependencies: {
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    timeoutMs?: number
    onRateLimited?: (retryAfterSeconds: number) => Promise<void>
  } = {},
): Promise<SourceLeaderboardPage> {
  if (!leaderboardModes.includes(input.mode)) {
    throw new LeaderboardSourceError('source_contract_invalid', `unsupported source mode ${input.mode}`, false)
  }
  if (!regionalLeaderboardScopes.includes(input.region)) {
    throw new LeaderboardSourceError('source_contract_invalid', `unsupported source region ${input.region}`, false)
  }
  if (!Number.isSafeInteger(input.page) || input.page < 1) {
    throw new LeaderboardSourceError('source_contract_invalid', 'source page must be a positive integer', false)
  }
  const url = `${sourceBase}?region=${input.region}&game_mode=${sourceModes[input.mode]}&page=${input.page}&max_results=50&leaderboard=prod`
  let response: Response
  try {
    response = await (dependencies.fetcher ?? fetch)(url, {
      signal: AbortSignal.timeout(dependencies.timeoutMs ?? 15_000),
    })
  } catch (error) {
    throw new LeaderboardSourceError(
      'source_transport_failed',
      `V1 leaderboard request failed for ${input.mode}/${input.region}`,
      true,
      { cause: error },
    )
  }
  if (!response.ok) {
    if (response.status === 429) await dependencies.onRateLimited?.(retryAfterSeconds(response))
    if (response.status === 404) {
      throw new LeaderboardSourceError(
        'source_not_found',
        `V1 leaderboard returned 404 for ${input.mode}/${input.region}`,
        false,
      )
    }
    throw new LeaderboardSourceError(
      'source_unavailable',
      `V1 leaderboard returned ${response.status} for ${input.mode}/${input.region}`,
      response.status === 429 || response.status >= 500,
    )
  }
  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new LeaderboardSourceError('source_contract_invalid', 'V1 leaderboard returned invalid JSON', false, {
      cause: error,
    })
  }
  return decodeLeaderboardPage(body, input)
}
