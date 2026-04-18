import { INTRO_OFFSET_MS, type ParsedReplay } from '@brawltome/replay-format'
import { computeDedupeHash } from '../dedupe'
import type { MatchRow } from '../match'
import type { MatchRepo } from '../match.repo'

export interface BackfillDeps {
  matchRepo: MatchRepo
  r2Get: (key: string) => Promise<Uint8Array>
  parse: (raw: Uint8Array) => ParsedReplay
}

export async function backfillPending(deps: BackfillDeps, row: MatchRow): Promise<void> {
  if (row.parseStatus !== 'pending') return

  const raw = await deps.r2Get(row.replayStorageKey)
  const parsed = deps.parse(raw)
  const duration = parsed.results[0]?.lengthMs ?? 0
  const fanfareId = parsed.results[0]?.endOfMatchFanfareId ?? 0
  const dedupeHash = computeDedupeHash({
    randomSeed: parsed.randomSeed,
    version: parsed.formatVersion,
    duration,
    fanfareId,
  })

  const existing = await deps.matchRepo.findByDedupeHash(dedupeHash)
  if (existing && existing.slug !== row.slug) {
    await deps.matchRepo.deleteMatch(row.slug)
    return
  }

  const events = parsed.koFaces.map((ev) => ({
    matchSlug: row.slug,
    entityId: ev.entityId,
    timestampMs: ev.timestampMs,
    kind: 'ko' as const,
  }))

  await deps.matchRepo.transaction(async (tx) => {
    await tx.markParsed(row.slug, {
      parseStatus: 'parsed',
      dedupeHash,
      randomSeed: parsed.randomSeed,
      playlistId: parsed.playlistId,
      playlistName: parsed.playlistName,
      onlineGame: parsed.onlineGame ? 1 : 0,
      levelId: parsed.levelId,
      durationMs: duration,
      matchDurationMs: Math.max(0, duration - INTRO_OFFSET_MS),
      endOfMatchFanfareId: fanfareId,
      scoringTypeId: parsed.gameSettings.scoringTypeId,
    })
    // displayName is intentionally not overwritten; PlayerMap value from ingest wins.
    for (const e of parsed.entities) {
      const hero = e.playerData.heroes[0] ?? null
      await tx.updatePlayerCosmetics(row.slug, e.id, {
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
        finalScore: parsed.results[0]?.scores[e.id] ?? null,
      })
    }
    await tx.insertEvents(events)
  })
}
