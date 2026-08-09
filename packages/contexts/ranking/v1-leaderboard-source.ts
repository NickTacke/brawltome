export const regionalLeaderboardScopes = ['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'] as const
export type RegionalLeaderboardScope = (typeof regionalLeaderboardScopes)[number]

export type SourceLeaderboardRow = {
  id: number
  username: string
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

function requiredName(value: unknown): string {
  if (typeof value !== 'string' || [...value].length > 256 || !/[^\p{Separator}\p{Format}]/u.test(value)) {
    invalid('username must contain between 1 and 256 visible Unicode characters')
  }
  return value
}

function decodeRow(value: unknown, index: number): SourceLeaderboardRow {
  if (!isObject(value)) invalid(`rankings[${index}] must be an object`)
  const region = value.region
  if (!regionalLeaderboardScopes.includes(region as RegionalLeaderboardScope)) {
    invalid(`rankings[${index}].region must be a supported region`)
  }
  const tier = value.tier
  if (tier !== undefined && tier !== null && (typeof tier !== 'string' || tier.length < 1 || tier.length > 100)) {
    invalid(`rankings[${index}].tier must be a non-empty bounded string when present`)
  }
  if (!Array.isArray(value.players) || value.players.length !== 1 || !isObject(value.players[0])) {
    invalid(`rankings[${index}].players must contain exactly one player object`)
  }
  const player = value.players[0]
  const rating = requiredInteger(value.rating, `rankings[${index}].rating`, 0)
  const bestRating = requiredInteger(value.best_rating, `rankings[${index}].best_rating`, 0)
  if (bestRating < rating) invalid(`rankings[${index}].best_rating cannot be below rating`)
  const wins = requiredInteger(value.wins, `rankings[${index}].wins`, 0)
  const losses = requiredInteger(value.losses, `rankings[${index}].losses`, 0)
  if (wins + losses > 2_147_483_647) invalid(`rankings[${index}] wins plus losses exceeds int32`)
  return {
    id: requiredInteger(player.id, `rankings[${index}].players[0].id`, 1),
    username: requiredName(player.username),
    rating,
    best_rating: bestRating,
    rank: requiredInteger(value.rank, `rankings[${index}].rank`, 1),
    wins,
    losses,
    region: region as RegionalLeaderboardScope,
    tier: typeof tier === 'string' ? tier : null,
  }
}

export function decode1v1LeaderboardPage(
  value: unknown,
  expected: { region: RegionalLeaderboardScope; page: number },
): SourceLeaderboardPage {
  if (!isObject(value)) invalid('leaderboard response must be an object')
  if (!Array.isArray(value.rankings)) invalid('rankings must be an array')
  if (value.rankings.length > 50) invalid('rankings cannot contain more than 50 rows')
  const totalPages = requiredInteger(value.total_pages, 'total_pages', 1)
  if (!Number.isSafeInteger(expected.page) || expected.page < 1 || expected.page > totalPages) {
    invalid(`requested page ${expected.page} exceeds total_pages ${totalPages}`)
  }
  return {
    rankings: value.rankings.map((row, index) => decodeRow(row, index)),
    totalPages,
  }
}

const sourceBase = 'https://api.brawlhalla.com/v1/leaderboard/ranked'

export async function fetch1v1LeaderboardPage(
  input: { region: RegionalLeaderboardScope; page: number },
  dependencies: {
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    timeoutMs?: number
  } = {},
): Promise<SourceLeaderboardPage> {
  if (!regionalLeaderboardScopes.includes(input.region)) {
    throw new LeaderboardSourceError('source_contract_invalid', `unsupported source region ${input.region}`, false)
  }
  if (!Number.isSafeInteger(input.page) || input.page < 1) {
    throw new LeaderboardSourceError('source_contract_invalid', 'source page must be a positive integer', false)
  }
  const url = `${sourceBase}?region=${input.region}&game_mode=1v1&page=${input.page}&max_results=50&leaderboard=prod`
  let response: Response
  try {
    response = await (dependencies.fetcher ?? fetch)(url, {
      signal: AbortSignal.timeout(dependencies.timeoutMs ?? 15_000),
    })
  } catch (error) {
    throw new LeaderboardSourceError(
      'source_transport_failed',
      `V1 leaderboard request failed for ${input.region}`,
      true,
      {
        cause: error,
      },
    )
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new LeaderboardSourceError('source_not_found', `V1 leaderboard returned 404 for ${input.region}`, false)
    }
    throw new LeaderboardSourceError(
      'source_unavailable',
      `V1 leaderboard returned ${response.status} for ${input.region}`,
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
  return decode1v1LeaderboardPage(body, input)
}
