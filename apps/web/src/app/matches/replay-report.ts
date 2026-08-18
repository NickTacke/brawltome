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
    kos: number | null
    deaths: number | null
    suicides: number | null
    clashes: number | null
    damageDealt: number | null
    damageTaken: number | null
    teamDamageDealt: number | null
    teamDamageTaken: number | null
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
    dodgesPerMinute: number | null
    dashesPerMinute: number | null
    jumpsPerMinute: number | null
    dashJumpsPerMinute: number | null
    airDodgeShare: number | null
    airJumpShare: number | null
    dashJumpShare: number | null
    groundTimeShare: number | null
    airTimeShare: number | null
    wallTimeShare: number | null
  }
  equipment: ReplayReportEquipment[] | null
  powers: ReplayReportPower[] | null
}

export type ReplayReportKnockout = {
  timestampMs: number
  scorerName: string | null
  victimName: string
}

export type ReplayReportTeam = {
  id: string
  playerSlots: number[]
  score: number | null
  won: boolean
}

export type ReplayReport = {
  source: 'real' | 'preview'
  title: string
  mapName: string
  mode: string
  durationMs: number
  playedAt: string | null
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
  teams: ReplayReportTeam[]
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

  const players: ReplayReportPlayer[] = replay.players.map((player) => {
    const native = nativeBySlot.get(player.slot)
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
    const positioningTotal = native ? native.groundTimeMs + native.airTimeMs + native.wallTimeMs : 0

    return {
      slot: player.slot,
      name: player.name,
      profileHref: player.playerId !== null && player.playerId > 0 ? `/player/${player.playerId}` : null,
      teamId: String(player.teamId),
      score: player.score,
      won: winningTeamId !== null && player.teamId === winningTeamId,
      appearance: resolvePlayerAppearance(player.loadout.legendId, player.loadout.costumeId),
      combat: {
        kos: native?.kos ?? null,
        deaths: native?.deaths ?? null,
        suicides: native?.suicides ?? null,
        clashes: native?.clashes ?? null,
        damageDealt: native?.damageDealt ?? null,
        damageTaken: native?.damageTaken ?? null,
        teamDamageDealt: native?.teamDamageDealt ?? null,
        teamDamageTaken: native?.teamDamageTaken ?? null,
        damageDealtPerMinute:
          playerSummary?.damageDealtPerMinute ??
          (native ? safeRatio(native.damageDealt * 60_000, replay.durationMs) : null),
        damageDealtPerKo:
          playerSummary?.damageDealtPerKo ?? (native ? safeRatio(native.damageDealt, native.kos) : null),
        damageTakenPerDeath:
          playerSummary?.damageTakenPerDeath ?? (native ? safeRatio(native.damageTaken, native.deaths) : null),
        koDeathRatio: playerSummary?.koDeathRatio ?? (native ? safeRatio(native.kos, native.deaths) : null),
      },
      movement: {
        dodges: native?.dodges ?? null,
        dashes: native?.dashes ?? null,
        jumps: native?.jumps ?? null,
        dashJumps: native?.dashJumps ?? null,
        dodgesPerMinute:
          playerSummary?.dodgesPerMinute ?? (native ? safeRatio(native.dodges * 60_000, replay.durationMs) : null),
        dashesPerMinute:
          playerSummary?.dashesPerMinute ?? (native ? safeRatio(native.dashes * 60_000, replay.durationMs) : null),
        jumpsPerMinute:
          playerSummary?.jumpsPerMinute ?? (native ? safeRatio(native.jumps * 60_000, replay.durationMs) : null),
        dashJumpsPerMinute: native ? safeRatio(native.dashJumps * 60_000, replay.durationMs) : null,
        airDodgeShare: playerSummary?.airDodgeShare ?? (native ? safeRatio(native.airDodges, native.dodges) : null),
        airJumpShare: playerSummary?.airJumpShare ?? (native ? safeRatio(native.airJumps, native.jumps) : null),
        dashJumpShare: playerSummary?.dashJumpShare ?? (native ? safeRatio(native.dashJumps, native.dashes) : null),
        groundTimeShare:
          playerSummary?.groundTimeShare ?? (native ? safeRatio(native.groundTimeMs, positioningTotal) : null),
        airTimeShare: playerSummary?.airTimeShare ?? (native ? safeRatio(native.airTimeMs, positioningTotal) : null),
        wallTimeShare: playerSummary?.wallTimeShare ?? (native ? safeRatio(native.wallTimeMs, positioningTotal) : null),
      },
      equipment,
      powers,
    }
  })

  const teamScores = new Map(replay.teamScores.map(({ teamId, score }) => [String(teamId), score]))
  const teams = new Map<string, ReplayReportTeam>()
  for (const player of players) {
    const team = teams.get(player.teamId)
    if (team) team.playerSlots.push(player.slot)
    else {
      teams.set(player.teamId, {
        id: player.teamId,
        playerSlots: [player.slot],
        score: teamScores.get(player.teamId) ?? null,
        won: player.won,
      })
    }
  }
  const teamList = [...teams.values()]
  const namesBySlot = new Map(players.map(({ slot, name }) => [slot, name]))

  return {
    source: 'real',
    title: teamList.map(({ playerSlots }) => playerSlots.map((slot) => namesBySlot.get(slot)).join(' & ')).join(' vs '),
    mapName,
    mode: `Playlist ${replay.playlistId}`,
    durationMs: replay.durationMs,
    playedAt: null,
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
    teams: teamList,
    players,
    knockouts: [...replay.koTimeline]
      .sort((left, right) => left.timestampMs - right.timestampMs)
      .map((knockout) => ({
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
