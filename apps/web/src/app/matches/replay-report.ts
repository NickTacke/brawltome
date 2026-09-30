import { MATCH_SUMMARY_EXTENSION_URI, NATIVE_EXTENSION_URI, type ReplayJobDetailContract } from '@brawltome/contracts'

type Result = NonNullable<ReplayJobDetailContract['result']>
type ReplayReportLimitation = Result['core']['limitations'][number]

type ReplayReportPlayer = {
  slot: number
  name: string
  playerId: number | null
  teamId: number
  score: number
  legendId: number
  won: boolean
  damageDealt: number | null
  damageTaken: number | null
  kos: number | null
  deaths: number | null
  suicides: number | null
  clashes: number | null
  teamDamageDealt: number | null
  teamDamageTaken: number | null
  teamKos: number | null
  damageDealtPerKo: number | null
  damageTakenPerDeath: number | null
  damageDealtPerMinute: number | null
  damageTakenPerMinute: number | null
  kosPerMinute: number | null
  deathsPerMinute: number | null
  dodgesPerMinute: number | null
  dashesPerMinute: number | null
  jumpsPerMinute: number | null
  airDodgeShare: number | null
  airJumpShare: number | null
  dashJumpShare: number | null
  groundTimeShare: number | null
  airTimeShare: number | null
  wallTimeShare: number | null
  dodges: number | null
  airDodges: number | null
  airJumps: number | null
  dashes: number | null
  jumps: number | null
  dashJumps: number | null
}

type ReplayReportEquipment = {
  slot: number
  key: string
  heldTimeMs: number | null
  heldTimeShare: number | null
  damageTaken: number | null
}

type ReplayReportPower = {
  slot: number
  equipmentKey: string
  powerKey: string
  uses: number | null
  enemyHits: number | null
  enemyDamage: number | null
  enemyKOs: number | null
  teamHits: number | null
  teamDamage: number | null
  accuracy: number | null
  hitsPerUse: number | null
  damagePerHit: number | null
  damagePerUse: number | null
  heldTimeShare: number | null
}

type ReplayReport = {
  players: ReplayReportPlayer[]
  equipment: ReplayReportEquipment[]
  powers: ReplayReportPower[]
  knockouts: Array<{
    timestampMs: number
    victimSlot: number
    scoringSlot: number | null
    index: number
  }>
  damageMaximum: number
  limitations: ReplayReportLimitation[]
}

type NativePowerCounters = {
  EnemyDamage: number
  EnemyHits: number
  EnemyKOs: number
  TeamDamage: number
  TeamHits: number
  Uses: number
}

type NativeEquipment = {
  TimeHeld: number
  DamageTaken?: number
  Powers?: Record<string, NativePowerCounters>
}

type NativePayload = {
  Equipment: Record<string, NativeEquipment>
  Sequence: unknown[]
}

type NativeExtension = {
  data: {
    players: Array<{ slot: number; payload: NativePayload }>
  }
}

type SummaryExtension = NonNullable<Result['extensions'][typeof MATCH_SUMMARY_EXTENSION_URI]>
type SummaryPlayer = SummaryExtension['data']['players'][number]
type SummaryEquipment = SummaryExtension['data']['equipment'][number]
type SummaryPower = SummaryExtension['data']['powers'][number]
type NativePlayer = Result['core']['native']['players'][number]

type ReportContext = {
  result: Result
  summary: SummaryExtension | undefined
  summaryPlayers: Map<number, SummaryPlayer>
  summaryEquipment: Map<string, SummaryEquipment>
  summaryPowers: Map<string, SummaryPower>
  nativePlayers: Map<number, NativePlayer>
  nativePayloads: Map<number, NativePayload>
  winningTeam: number | null
}

function nativeExtension(result: Result): NativeExtension | null {
  const extension = result.extensions[NATIVE_EXTENSION_URI]
  if (!extension || typeof extension !== 'object' || !('data' in extension)) return null
  return extension as NativeExtension
}

function createContext(result: Result): ReportContext {
  const summary = result.extensions[MATCH_SUMMARY_EXTENSION_URI]
  const native = nativeExtension(result)
  return {
    result,
    summary,
    summaryPlayers: new Map(summary?.data.players.map((player) => [player.slot, player]) ?? []),
    summaryEquipment: new Map(summary?.data.equipment.map((item) => [`${item.slot}:${item.key}`, item]) ?? []),
    summaryPowers: new Map(summary?.data.powers.map((power) => [`${power.slot}:${power.key}`, power]) ?? []),
    nativePlayers: new Map(result.core.native.players.map((player) => [player.slot, player])),
    nativePayloads: new Map(native?.data.players.map((player) => [player.slot, player.payload]) ?? []),
    winningTeam: result.core.replay.outcome.winningTeamId,
  }
}

export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}

function timeShare(summaryValue: number | null | undefined, numerator: number, total: number): number | null {
  if (summaryValue !== undefined && summaryValue !== null) return summaryValue
  return total > 0 ? numerator / total : null
}

function splitPowerKey(key: string): { equipmentKey: string; powerKey: string } {
  const separator = key.lastIndexOf('/')
  if (separator < 1 || separator === key.length - 1) return { equipmentKey: '', powerKey: key }
  return { equipmentKey: key.slice(0, separator), powerKey: key.slice(separator + 1) }
}

type BuildPowerInput = {
  slot: number
  equipmentKey: string
  powerKey: string
  counters: NativePowerCounters | undefined
  summaryPower: SummaryPower | undefined
  heldTimeShare: number | null
}

function ratio(numerator: number | null, denominator: number | null, fallback: number | null): number | null {
  if (denominator === null) return fallback
  return denominator > 0 ? (numerator ?? 0) / denominator : null
}

function buildPower({
  slot,
  equipmentKey,
  powerKey,
  counters,
  summaryPower,
  heldTimeShare,
}: BuildPowerInput): ReplayReportPower {
  const uses = counters?.Uses ?? null
  const enemyHits = counters?.EnemyHits ?? null
  const enemyDamage = counters?.EnemyDamage ?? null
  return {
    slot,
    equipmentKey,
    powerKey,
    uses,
    enemyHits,
    enemyDamage,
    enemyKOs: counters?.EnemyKOs ?? null,
    teamHits: counters?.TeamHits ?? null,
    teamDamage: counters?.TeamDamage ?? null,
    accuracy: null,
    hitsPerUse: ratio(enemyHits, uses, summaryPower?.enemyHitsPerUse ?? null),
    damagePerHit: ratio(enemyDamage, enemyHits, summaryPower?.enemyDamagePerHit ?? null),
    damagePerUse: ratio(enemyDamage, uses, summaryPower?.enemyDamagePerUse ?? null),
    heldTimeShare,
  }
}

function buildPlayers(context: ReportContext): ReplayReportPlayer[] {
  return context.result.core.replay.players.map((player) => {
    const metrics = context.nativePlayers.get(player.slot)
    const summary = context.summaryPlayers.get(player.slot)
    const movementTotal = (metrics?.groundTimeMs ?? 0) + (metrics?.airTimeMs ?? 0) + (metrics?.wallTimeMs ?? 0)
    return {
      slot: player.slot,
      name: player.name,
      playerId: player.playerId,
      teamId: player.teamId,
      score: player.score,
      legendId: player.loadout.legendId,
      won: context.winningTeam !== null && player.teamId === context.winningTeam,
      damageDealt: metrics?.damageDealt ?? null,
      damageTaken: metrics?.damageTaken ?? null,
      kos: metrics?.kos ?? null,
      deaths: metrics?.deaths ?? null,
      suicides: metrics?.suicides ?? null,
      clashes: metrics?.clashes ?? null,
      teamDamageDealt: metrics?.teamDamageDealt ?? null,
      teamDamageTaken: metrics?.teamDamageTaken ?? null,
      teamKos: metrics?.teamKos ?? null,
      damageDealtPerKo: summary?.damageDealtPerKo ?? null,
      damageTakenPerDeath: summary?.damageTakenPerDeath ?? null,
      damageDealtPerMinute: summary?.damageDealtPerMinute ?? null,
      damageTakenPerMinute: summary?.damageTakenPerMinute ?? null,
      kosPerMinute: summary?.kosPerMinute ?? null,
      deathsPerMinute: summary?.deathsPerMinute ?? null,
      dodgesPerMinute: summary?.dodgesPerMinute ?? null,
      dashesPerMinute: summary?.dashesPerMinute ?? null,
      jumpsPerMinute: summary?.jumpsPerMinute ?? null,
      airDodgeShare: summary?.airDodgeShare ?? null,
      airJumpShare: summary?.airJumpShare ?? null,
      dashJumpShare: summary?.dashJumpShare ?? null,
      groundTimeShare: timeShare(summary?.groundTimeShare, metrics?.groundTimeMs ?? 0, movementTotal),
      airTimeShare: timeShare(summary?.airTimeShare, metrics?.airTimeMs ?? 0, movementTotal),
      wallTimeShare: timeShare(summary?.wallTimeShare, metrics?.wallTimeMs ?? 0, movementTotal),
      dodges: metrics?.dodges ?? null,
      airDodges: metrics?.airDodges ?? null,
      airJumps: metrics?.airJumps ?? null,
      dashes: metrics?.dashes ?? null,
      jumps: metrics?.jumps ?? null,
      dashJumps: metrics?.dashJumps ?? null,
    }
  })
}

function nativeHeldTimeShare(context: ReportContext, slot: number, key: string): number | null {
  const equipment = context.nativePayloads.get(slot)?.Equipment
  if (!equipment) return null
  const total = Object.values(equipment).reduce((sum, item) => sum + item.TimeHeld, 0)
  return total > 0 ? (equipment[key]?.TimeHeld ?? 0) / total : null
}

function buildEquipment(context: ReportContext): ReplayReportEquipment[] {
  const identities = new Set<string>()
  for (const item of context.summary?.data.equipment ?? []) identities.add(`${item.slot}:${item.key}`)
  for (const [slot, payload] of context.nativePayloads) {
    for (const key of Object.keys(payload.Equipment)) identities.add(`${slot}:${key}`)
  }

  return [...identities]
    .map((identity) => {
      const separator = identity.indexOf(':')
      const slot = Number(identity.slice(0, separator))
      const key = identity.slice(separator + 1)
      const summary = context.summaryEquipment.get(identity)
      const nativeEquipment = context.nativePayloads.get(slot)?.Equipment[key]
      return {
        slot,
        key,
        heldTimeMs: nativeEquipment?.TimeHeld ?? null,
        heldTimeShare: summary?.heldTimeShare ?? nativeHeldTimeShare(context, slot, key),
        damageTaken: nativeEquipment?.DamageTaken ?? null,
      }
    })
    .toSorted((left, right) => left.slot - right.slot || left.key.localeCompare(right.key))
}

function buildNativePowers(context: ReportContext): ReplayReportPower[] {
  return [...context.nativePayloads].flatMap(([slot, payload]) =>
    Object.entries(payload.Equipment).flatMap(([equipmentKey, item]) =>
      Object.entries(item.Powers ?? {}).map(([powerKey, counters]) =>
        buildPower({
          slot,
          equipmentKey,
          powerKey,
          counters,
          summaryPower: context.summaryPowers.get(`${slot}:${equipmentKey}/${powerKey}`),
          heldTimeShare:
            context.summaryEquipment.get(`${slot}:${equipmentKey}`)?.heldTimeShare ??
            nativeHeldTimeShare(context, slot, equipmentKey),
        }),
      ),
    ),
  )
}

function buildSummaryPowers(context: ReportContext): ReplayReportPower[] {
  return (context.summary?.data.powers ?? []).map((power) => {
    const { equipmentKey, powerKey } = splitPowerKey(power.key)
    return buildPower({
      slot: power.slot,
      equipmentKey,
      powerKey,
      counters: undefined,
      summaryPower: power,
      heldTimeShare: context.summaryEquipment.get(`${power.slot}:${equipmentKey}`)?.heldTimeShare ?? null,
    })
  })
}

function buildPowers(context: ReportContext): ReplayReportPower[] {
  const nativePowers = buildNativePowers(context)
  return (nativePowers.length > 0 ? nativePowers : buildSummaryPowers(context)).toSorted(
    (left, right) =>
      left.slot - right.slot ||
      left.equipmentKey.localeCompare(right.equipmentKey) ||
      left.powerKey.localeCompare(right.powerKey),
  )
}

function buildKnockouts(result: Result): ReplayReport['knockouts'] {
  return result.core.replay.koTimeline
    .map((event, index) => ({ ...event, index }))
    .toSorted(
      (left, right) =>
        left.timestampMs - right.timestampMs || left.victimSlot - right.victimSlot || left.index - right.index,
    )
}

export function buildReplayReport(job: ReplayJobDetailContract): ReplayReport {
  const result = job.result
  if (!result) return { players: [], equipment: [], powers: [], knockouts: [], damageMaximum: 1, limitations: [] }

  const context = createContext(result)
  const players = buildPlayers(context)
  return {
    players,
    equipment: buildEquipment(context),
    powers: buildPowers(context),
    knockouts: buildKnockouts(result),
    damageMaximum: Math.max(
      ...players.flatMap(({ damageDealt, damageTaken }) => [damageDealt ?? 0, damageTaken ?? 0]),
      1,
    ),
    limitations: result.core.limitations,
  }
}
