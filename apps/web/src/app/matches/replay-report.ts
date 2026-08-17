import { MATCH_SUMMARY_EXTENSION_URI, NATIVE_EXTENSION_URI, type ReplayJobDetailContract } from '@brawltome/contracts'
import { type PlayerAppearance, getLevelById, resolvePlayerAppearance } from '@brawltome/game-data'

export type ReplayReportPower = {
  key: string
  equipmentKey: string
  uses: number
  enemyHits: number
  enemyDamage: number
  enemyKos: number
  enemyDamagePerHit: number | null
  enemyDamagePerUse: number | null
  enemyHitsPerUse: number | null
  enemyKosPerUse: number | null
}

export type ReplayReportEquipment = {
  key: string
  heldTimeShare: number | null
  enemyDamage: number
}

export type ReplayReportPlayer = {
  slot: number
  name: string
  profileHref: string | null
  teamId: string
  score: number
  won: boolean
  appearance: PlayerAppearance
  combat: {
    kos: number
    deaths: number
    suicides: number
    clashes: number
    damageDealt: number
    damageTaken: number
    teamDamageDealt: number
    teamDamageTaken: number
    damageDealtPerMinute: number | null
    damageDealtPerKo: number | null
    damageTakenPerDeath: number | null
    koDeathRatio: number | null
  }
  movement: {
    dodges: number | null
    dashes: number | null
    jumps: number | null
    dashJumps: number | null
    airDodgeShare: number | null
    airJumpShare: number | null
    dashJumpShare: number | null
    groundTimeShare: number | null
    airTimeShare: number | null
    wallTimeShare: number | null
  }
  equipment: ReplayReportEquipment[]
  powers: ReplayReportPower[]
}

export type ReplayReportKnockout = {
  timestampMs: number
  scorerName: string | null
  victimName: string
}

export type ReplayReport = {
  source: 'real' | 'preview'
  title: string
  mapName: string
  mode: string
  durationMs: number
  analyzedAt: string | null
  fileName: string | null
  gameBuild: string | null
  provenance: {
    collector: string
    processorVersion: string
    qualificationProfile: string
    replayDigest: string
  } | null
  winnerLabel: string
  players: ReplayReportPlayer[]
  knockouts: ReplayReportKnockout[]
  capabilities: {
    eventTimeline: boolean
    dodgeDirections: boolean
    engagements: boolean
  }
  limitations: readonly { code: string; text: string }[]
}

export function safeRatio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null
}

export function replayReportFromJob(job: ReplayJobDetailContract): ReplayReport | null {
  if (job.status !== 'completed' || !job.result) return null

  const { core, extensions } = job.result
  const { replay } = core
  const nativeExtension = extensions[NATIVE_EXTENSION_URI]
  const summary = extensions[MATCH_SUMMARY_EXTENSION_URI]
  const nativeBySlot = new Map(core.native.players.map((player) => [player.slot, player]))
  const payloadBySlot = new Map(nativeExtension.data.players.map((player) => [player.slot, player.payload]))
  const summaryBySlot = new Map(summary?.data.players.map((player) => [player.slot, player]) ?? [])
  const equipmentSummaryBySlotAndKey = new Map(
    summary?.data.equipment.map((equipment) => [`${equipment.slot}:${equipment.key}`, equipment]) ?? [],
  )
  const playerBySlot = new Map(replay.players.map((player) => [player.slot, player]))
  const winningTeamId = replay.outcome.winningTeamId
  const winners = winningTeamId === null ? [] : replay.players.filter((player) => player.teamId === winningTeamId)
  const mapName = getLevelById(replay.mapId)?.displayName ?? `Map ${replay.mapId}`

  const players = replay.players.flatMap<ReplayReportPlayer>((player) => {
    const native = nativeBySlot.get(player.slot)
    if (!native) return []

    const playerSummary = summaryBySlot.get(player.slot)
    const equipmentEntries = Object.entries(payloadBySlot.get(player.slot)?.Equipment ?? {})
    const equipment = equipmentEntries.map(([key, counters]) => {
      const summaryRow = equipmentSummaryBySlotAndKey.get(`${player.slot}:${key}`)
      return {
        key,
        heldTimeShare: summaryRow ? summaryRow.heldTimeShare : safeRatio(counters.TimeHeld, replay.durationMs),
        enemyDamage: Object.values(counters.Powers ?? {}).reduce((total, power) => total + power.EnemyDamage, 0),
      }
    })
    const powers = equipmentEntries.flatMap(([equipmentKey, counters]) =>
      Object.entries(counters.Powers ?? {}).map(([key, power]) => ({
        key,
        equipmentKey,
        uses: power.Uses,
        enemyHits: power.EnemyHits,
        enemyDamage: power.EnemyDamage,
        enemyKos: power.EnemyKOs,
        enemyDamagePerHit: safeRatio(power.EnemyDamage, power.EnemyHits),
        enemyDamagePerUse: safeRatio(power.EnemyDamage, power.Uses),
        enemyHitsPerUse: safeRatio(power.EnemyHits, power.Uses),
        enemyKosPerUse: safeRatio(power.EnemyKOs, power.Uses),
      })),
    )

    return [
      {
        slot: player.slot,
        name: player.name,
        profileHref: player.playerId !== null && player.playerId > 0 ? `/player/${player.playerId}` : null,
        teamId: String(player.teamId),
        score: player.score,
        won: winningTeamId !== null && player.teamId === winningTeamId,
        appearance: resolvePlayerAppearance(player.loadout.legendId, player.loadout.costumeId),
        combat: {
          kos: native.kos,
          deaths: native.deaths,
          suicides: native.suicides,
          clashes: native.clashes,
          damageDealt: native.damageDealt,
          damageTaken: native.damageTaken,
          teamDamageDealt: native.teamDamageDealt,
          teamDamageTaken: native.teamDamageTaken,
          damageDealtPerMinute: playerSummary
            ? playerSummary.damageDealtPerMinute
            : safeRatio(native.damageDealt * 60_000, replay.durationMs),
          damageDealtPerKo: playerSummary ? playerSummary.damageDealtPerKo : safeRatio(native.damageDealt, native.kos),
          damageTakenPerDeath: playerSummary
            ? playerSummary.damageTakenPerDeath
            : safeRatio(native.damageTaken, native.deaths),
          koDeathRatio: playerSummary ? playerSummary.koDeathRatio : safeRatio(native.kos, native.deaths),
        },
        movement: {
          dodges: native.dodges,
          dashes: native.dashes,
          jumps: native.jumps,
          dashJumps: native.dashJumps,
          airDodgeShare: playerSummary ? playerSummary.airDodgeShare : safeRatio(native.airDodges, native.dodges),
          airJumpShare: playerSummary ? playerSummary.airJumpShare : safeRatio(native.airJumps, native.jumps),
          dashJumpShare: playerSummary ? playerSummary.dashJumpShare : safeRatio(native.dashJumps, native.dashes),
          groundTimeShare: playerSummary
            ? playerSummary.groundTimeShare
            : safeRatio(native.groundTimeMs, replay.durationMs),
          airTimeShare: playerSummary ? playerSummary.airTimeShare : safeRatio(native.airTimeMs, replay.durationMs),
          wallTimeShare: playerSummary ? playerSummary.wallTimeShare : safeRatio(native.wallTimeMs, replay.durationMs),
        },
        equipment,
        powers,
      },
    ]
  })

  return {
    source: 'real',
    title: replay.players.map(({ name }) => name).join(' vs '),
    mapName,
    mode: `Playlist ${replay.playlistId}`,
    durationMs: replay.durationMs,
    analyzedAt: job.updatedAt,
    fileName: job.fileName,
    gameBuild: core.provenance.gameBuild,
    provenance: {
      collector: core.provenance.collector,
      processorVersion: core.provenance.processorVersion,
      qualificationProfile: core.provenance.qualificationProfile,
      replayDigest: replay.replayDigest,
    },
    winnerLabel:
      winningTeamId === null ? 'Draw' : winners.map(({ name }) => name).join(' & ') || `Team ${winningTeamId}`,
    players,
    knockouts: replay.koTimeline.map((knockout) => ({
      timestampMs: knockout.timestampMs,
      scorerName: knockout.scoringSlot === null ? null : (playerBySlot.get(knockout.scoringSlot)?.name ?? null),
      victimName: playerBySlot.get(knockout.victimSlot)?.name ?? 'Unknown player',
    })),
    capabilities: { eventTimeline: false, dodgeDirections: false, engagements: false },
    limitations: [core.limitations, nativeExtension.limitations, summary?.limitations ?? []]
      .flat()
      .map(({ code, text }) => ({ code, text })),
  }
}
