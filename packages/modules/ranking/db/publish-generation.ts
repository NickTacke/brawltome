import { randomUUID } from 'node:crypto'
import type { Sql } from '@brawltome/foundation'
import { lockActiveLeaderboardLease } from '@brawltome/queue'
import {
  type LeaderboardGenerationCandidate,
  type LeaderboardScope,
  leaderboardModeFromOperationKind,
  type PublicationResult,
  type PublishedLeaderboardIdentity,
  type PublishedLeaderboardRow,
  type RankingPublicationAuthorization,
  regionPublicationKey,
} from '../leaderboard'
import { type LeaderboardMode, regionalLeaderboardScopes } from '../v1-leaderboard-source'
import { recordLeaderboardEffect } from './leaderboard-effects'

const rowBatchSize = 500

function storedIdentity(identity: PublishedLeaderboardIdentity) {
  if (identity.type === 'fixed-two-vs-two-team') {
    return {
      identity_kind: identity.type,
      player_one_id: identity.players[0].brawlhallaId,
      player_one_name: identity.players[0].name,
      player_two_id: identity.players[1].brawlhallaId,
      player_two_name: identity.players[1].name,
    }
  }

  return {
    identity_kind: identity.type,
    player_one_id: identity.player.brawlhallaId,
    player_one_name: identity.player.name,
    player_two_id: null,
    player_two_name: null,
  }
}

function validateCandidateMode(authorization: RankingPublicationAuthorization, mode: LeaderboardMode): void {
  if (leaderboardModeFromOperationKind(authorization.operationKind) !== mode) {
    throw new Error(`candidate mode ${mode} does not match operation kind ${authorization.operationKind}`)
  }
}

function effectOperationIdOf(authorization: RankingPublicationAuthorization): string {
  return authorization.effectOperationId ?? authorization.operationId
}

async function insertSnapshot(
  sql: Sql,
  generationId: string,
  mode: LeaderboardMode,
  scope: LeaderboardScope,
  rows: readonly PublishedLeaderboardRow[],
): Promise<void> {
  const snapshotId = randomUUID()

  await sql`
    INSERT INTO rankings.snapshots (id, generation_id, mode, scope, row_count)
    VALUES (${snapshotId}, ${generationId}, ${mode}, ${scope}, ${rows.length})
  `

  const storedRows = rows.map((row, index) => ({
    snapshot_id: snapshotId,
    mode,
    ordinal: index + 1,
    standing: row.standing,
    source_rank: row.sourceRank,
    ...storedIdentity(row.identity),
    region: row.region,
    rating: row.rating,
    peak_rating: row.peakRating,
    wins: row.wins,
    losses: row.losses,
    tier: row.tier,
  }))

  for (let offset = 0; offset < storedRows.length; offset += rowBatchSize) {
    await sql`
      INSERT INTO rankings.snapshot_rows ${sql(
        storedRows.slice(offset, offset + rowBatchSize),
        'snapshot_id',
        'mode',
        'ordinal',
        'standing',
        'source_rank',
        'identity_kind',
        'player_one_id',
        'player_one_name',
        'player_two_id',
        'player_two_name',
        'region',
        'rating',
        'peak_rating',
        'wins',
        'losses',
        'tier',
      )}
    `
  }
}

// snapshots can only join an unfinalized generation, so readers never see one half written
async function insertFinalizedGeneration(
  sql: Sql,
  operationId: string,
  candidate: LeaderboardGenerationCandidate,
): Promise<void> {
  const generationId = randomUUID()

  const provenance = {
    source: 'brawlhalla-v1-ranked-leaderboard',
    contractVersion: 2,
    pageDepth: candidate.pageDepth,
    scopePageDepths: candidate.scopePageDepths,
    staleRegions: candidate.staleRegions,
  }

  await sql`
    INSERT INTO rankings.generations
      (id, operation_id, operation_key, mode, observed_at, schedule_window_at,
       expected_next_publication_at, page_depth, source, source_contract_version, finalized, provenance)
    VALUES
      (${generationId}, ${operationId}, ${candidate.operationKey}, ${candidate.mode},
       ${candidate.observedAt}, ${candidate.scheduleWindowAt}, ${candidate.expectedNextPublicationAt},
       ${candidate.pageDepth}, 'brawlhalla-v1-ranked-leaderboard', 2, false, ${sql.json(provenance)})
  `

  for (const [scope, rows] of candidate.snapshots) {
    await insertSnapshot(sql, generationId, candidate.mode, scope, rows)
  }

  await sql`UPDATE rankings.generations SET finalized = true WHERE id = ${generationId}`
}

// a publication is identified by its key; the same key under another operation or mode is someone else's effect
async function existingPublication(
  sql: Sql,
  operationId: string,
  candidate: LeaderboardGenerationCandidate,
): Promise<PublicationResult | null> {
  const [existing] = await sql<{ operation_id: string; mode: LeaderboardMode }[]>`
    SELECT operation_id, mode
    FROM rankings.generations
    WHERE operation_key = ${candidate.operationKey}
  `

  if (!existing) return null

  const isSamePublication = existing.operation_id === operationId && existing.mode === candidate.mode

  return isSamePublication ? 'already-published' : 'effect-conflict'
}

function validateWindowScopes(candidate: LeaderboardGenerationCandidate): void {
  for (const scope of candidate.snapshots.keys()) {
    if (scope !== 'all' && !regionalLeaderboardScopes.includes(scope)) {
      throw new Error(`candidate scope ${scope} is not a leaderboard scope`)
    }
  }

  if (!candidate.snapshots.get('all')?.length) throw new Error('candidate scope all is empty')
}

/**
 * Publishes the global board under the scan's own key and records the leaderboard effect, which closes the window: a
 * newer window no longer supersedes it. Regional boards usually publish on their own first, but may come along.
 */
export async function publishWindowGeneration(
  sql: Sql,
  authorization: RankingPublicationAuthorization,
  candidate: LeaderboardGenerationCandidate,
): Promise<PublicationResult> {
  if (candidate.operationKey !== authorization.operationKey) throw new Error('candidate operation key mismatch')

  validateCandidateMode(authorization, candidate.mode)
  validateWindowScopes(candidate)

  const effect = await recordLeaderboardEffect(sql, authorization)

  if (effect === 'lease-lost' || effect === 'effect-conflict') return effect

  const operationId = effectOperationIdOf(authorization)
  const existing = await existingPublication(sql, operationId, candidate)

  if (existing) return existing

  if (effect === 'already-applied') throw new Error('leaderboard effect exists without its Ranking generation')

  await insertFinalizedGeneration(sql, operationId, candidate)

  return 'published'
}

function regionOf(candidate: LeaderboardGenerationCandidate) {
  const scopes = [...candidate.snapshots.keys()]
  const [scope] = scopes

  if (scopes.length !== 1 || !scope || scope === 'all' || !regionalLeaderboardScopes.includes(scope)) {
    throw new Error(`a region publication holds exactly one region, got ${scopes.join(', ') || 'none'}`)
  }

  return scope
}

/**
 * Publishes one region's board while the scan holds its lease, without recording the window's effect. The board
 * stays published even when the scan later fails or a newer window supersedes it.
 */
export async function publishRegionGeneration(
  sql: Sql,
  authorization: RankingPublicationAuthorization,
  candidate: LeaderboardGenerationCandidate,
): Promise<PublicationResult> {
  const region = regionOf(candidate)

  if (candidate.operationKey !== regionPublicationKey(authorization.operationKey, region)) {
    throw new Error(`region publication key mismatch for ${region}`)
  }

  validateCandidateMode(authorization, candidate.mode)

  if (!(await lockActiveLeaderboardLease(sql, authorization))) return 'lease-lost'

  const operationId = effectOperationIdOf(authorization)
  const existing = await existingPublication(sql, operationId, candidate)

  if (existing) return existing

  await insertFinalizedGeneration(sql, operationId, candidate)

  return 'published'
}
