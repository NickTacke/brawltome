import { INTRO_OFFSET_MS, type ParsedReplay } from '@brawltome/replay-format'
import { computeDedupeHash } from '../dedupe'
import type { MatchPlayerRow, MatchRow, MatchSlug } from '../match'
import type { MatchRepo } from '../match.repo'
import { generateSlug } from '../slug'

export type IngestErrorCode =
  | 'parse_error'
  | 'validation_error'
  | 'tampered'
  | 'oversize'
  | 'rate_limited'
  | 'scanner_not_ready'
  | 'slot_mismatch'
  | 'r2_upload_failed'

export class IngestError extends Error {
  constructor(
    public code: IngestErrorCode,
    public detail: string,
  ) {
    super(`${code}: ${detail}`)
    this.name = 'IngestError'
  }
}

// Allowed entity counts per playlist id. 0 (offline/custom) accepts anything;
// unknown ids are treated permissively.
const PLAYLIST_ENTITY_COUNTS: Record<number, number[]> = {
  0: [1, 2, 3, 4],
  1: [2],
  2: [4],
  6: [2],
  8: [4],
}

const MAX_DURATION_MS = 30 * 60 * 1000
const MAX_RAW_BYTES = 200 * 1024

export interface IngestDeps {
  matchRepo: MatchRepo
  r2Put: (key: string, bytes: Uint8Array) => Promise<void>
  reparseRaw: (raw: Uint8Array) => ParsedReplay
  knownLevelIds?: Set<number>
  knownHeroIds?: Set<number>
  knownPlaylistIds?: Set<number>
}

export interface IngestInput {
  userId: string
  parsedReplay: ParsedReplay
  entityBhids: Record<number, number>
  rawBytes: Uint8Array
  formatVersion: number
}

export interface IngestOk {
  slug: MatchSlug
  alreadyIngested?: true
}

export async function ingestReplay(deps: IngestDeps, input: IngestInput): Promise<IngestOk> {
  const { matchRepo, r2Put, reparseRaw, knownLevelIds, knownHeroIds, knownPlaylistIds } = deps
  const { userId, parsedReplay: pr, entityBhids, rawBytes, formatVersion } = input

  if (rawBytes.length > MAX_RAW_BYTES) {
    throw new IngestError('oversize', `raw is ${rawBytes.length} bytes, max ${MAX_RAW_BYTES}`)
  }

  if (pr.heroCount < 1 || pr.heroCount > 5) throw new IngestError('validation_error', 'heroCount')
  if (pr.results.length === 0) throw new IngestError('validation_error', 'results_empty')
  const duration = pr.results[0].lengthMs
  if (duration <= 0 || duration > MAX_DURATION_MS) {
    throw new IngestError('validation_error', 'duration')
  }
  const ids = pr.entities.map((e) => e.id)
  if (new Set(ids).size !== ids.length) {
    throw new IngestError('validation_error', 'duplicate_entity_id')
  }
  const allowedCounts = PLAYLIST_ENTITY_COUNTS[pr.playlistId] ?? [1, 2, 3, 4]
  if (!allowedCounts.includes(pr.entities.length)) {
    throw new IngestError(
      'validation_error',
      `entity_count ${pr.entities.length} vs playlist ${pr.playlistId}`,
    )
  }
  if (knownPlaylistIds && pr.playlistId !== 0 && !knownPlaylistIds.has(pr.playlistId)) {
    throw new IngestError('validation_error', `unknown playlistId ${pr.playlistId}`)
  }
  if (knownLevelIds && pr.levelId !== 0 && !knownLevelIds.has(pr.levelId)) {
    throw new IngestError('validation_error', `unknown levelId ${pr.levelId}`)
  }
  if (knownHeroIds) {
    for (const e of pr.entities) {
      for (const h of e.playerData.heroes) {
        if (!knownHeroIds.has(h.heroId)) {
          throw new IngestError('validation_error', `unknown heroId ${h.heroId}`)
        }
      }
    }
  }
  for (const ev of pr.koFaces) {
    if (ev.timestampMs < 0 || ev.timestampMs > duration) {
      throw new IngestError('validation_error', 'ko_timestamp')
    }
  }

  const serverParsed = reparseRaw(rawBytes)
  if (JSON.stringify(serverParsed) !== JSON.stringify(pr)) {
    throw new IngestError('tampered', 'client_parsed_mismatch')
  }

  const slotSet = new Set(ids)
  const bhidSlots = Object.keys(entityBhids).map(Number)
  if (bhidSlots.length === 0) throw new IngestError('scanner_not_ready', 'entity_bhids_empty')
  for (const s of bhidSlots) {
    if (!slotSet.has(s)) throw new IngestError('slot_mismatch', `slot ${s} not in entities`)
  }

  const dedupeHash = computeDedupeHash({
    randomSeed: pr.randomSeed,
    version: pr.formatVersion,
    duration,
    fanfareId: pr.results[0].endOfMatchFanfareId,
  })
  const existing = await matchRepo.findByDedupeHash(dedupeHash)
  if (existing) return { slug: existing.slug, alreadyIngested: true }

  const slug = generateSlug()
  const replayStorageKey = `replays/${slug}.replay`
  try {
    await r2Put(replayStorageKey, rawBytes)
  } catch (e) {
    throw new IngestError('r2_upload_failed', (e as Error).message)
  }

  const matchRow: MatchRow = {
    slug,
    dedupeHash,
    uploadedBy: userId,
    uploadedAt: new Date(),
    parseStatus: 'parsed',
    formatVersion,
    replayStorageKey,
    replayBytes: rawBytes.length,
    gamePatch: null,
    randomSeed: pr.randomSeed,
    playlistId: pr.playlistId,
    playlistName: pr.playlistName,
    onlineGame: pr.onlineGame ? 1 : 0,
    levelId: pr.levelId,
    durationMs: duration,
    matchDurationMs: Math.max(0, duration - INTRO_OFFSET_MS),
    endOfMatchFanfareId: pr.results[0].endOfMatchFanfareId,
    winnerTeam: inferWinnerTeam(pr),
    scoringTypeId: pr.gameSettings.scoringTypeId,
    detailedStatsKey: null,
    simVersion: null,
    simRanAt: null,
  }
  await matchRepo.insertMatch(matchRow)

  const players: Omit<MatchPlayerRow, 'id'>[] = pr.entities.map((e) => {
    const bhid = entityBhids[e.id] ?? null
    const hero = e.playerData.heroes[0] ?? null
    return {
      matchSlug: slug,
      replayEntityId: e.id,
      brawlhallaId: bhid,
      linkSource: bhid === null ? null : 'overlay_memory',
      displayName: e.name,
      team: e.team,
      legendId: hero?.heroId ?? null,
      costumeId: hero?.costumeId ?? null,
      stanceIndex: hero?.stanceIndex ?? null,
      weaponSkin1: hero?.weaponSkin1 ?? null,
      weaponSkin2: hero?.weaponSkin2 ?? null,
      colorSchemeId: e.playerData.colorSchemeId,
      companionId: e.playerData.companionId,
      emitterId: e.playerData.emitterId,
      trailEffectId: e.playerData.trailEffectId,
      avatarId: e.playerData.avatarId,
      isBot: e.isBot ? 1 : 0,
      finalScore: pr.results[0].scores[e.id] ?? null,
    }
  })
  await matchRepo.insertPlayers(players)

  const events = pr.koFaces.map((ev) => ({
    matchSlug: slug,
    entityId: ev.entityId,
    timestampMs: ev.timestampMs,
    kind: 'ko' as const,
  }))
  await matchRepo.insertEvents(events)

  return { slug }
}

function inferWinnerTeam(pr: ParsedReplay): number | null {
  const deathsByTeam: Record<number, number> = {}
  for (const ev of pr.koFaces) {
    const ent = pr.entities.find((e) => e.id === ev.entityId)
    if (!ent) continue
    deathsByTeam[ent.team] = (deathsByTeam[ent.team] ?? 0) + 1
  }
  const teams = Object.keys(deathsByTeam).map(Number)
  if (teams.length < 2) return null
  const sorted = teams.sort((a, b) => deathsByTeam[a] - deathsByTeam[b])
  return deathsByTeam[sorted[0]] < deathsByTeam[sorted[1]] ? sorted[0] : null
}
