import { createHash } from 'node:crypto'
import { z } from 'zod'

// reads the one JSON line bh-native prints per replay; only what the tables keep is checked here. the timeline
// stays opaque: it goes to the object store whole, and the stats computed from it come later

export class UnknownFormatError extends Error {}

const SUPPORTED_FORMAT = 1

const errorLineSchema = z.object({ exit: z.number().int().positive() })

const named = z.object({ id: z.number().int(), name: z.string() })

const okLineSchema = z.object({
  exit: z.literal(0),
  patch: z.string().min(1).max(16),
  format: z.number().int(),
  stats: z.record(z.string(), z.unknown()).and(z.object({ GameDuration: z.number().nonnegative() })),
  match: z.object({
    map: named,
    rules: z.object({
      mode: named,
      queue: z.string().nullable().optional(),
      isRanked: z.boolean(),
      isCustom: z.boolean(),
      hasTeams: z.boolean(),
      hasTeamDamage: z.boolean(),
      stocks: z.number().int().nullable().optional(),
    }),
    players: z
      .array(
        z.object({
          slot: z.number().int().min(1),
          brawlhallaId: z.number().int(),
          name: z.string(),
          team: z.number().int(),
          legend: named,
        }),
      )
      .min(1),
  }),
  timeline: z
    .object({ events: z.array(z.object({ step: z.number(), type: z.string() }).loose()) })
    .loose()
    .optional(),
  reliability: z.object({
    isReliable: z.boolean(),
    checks: z.array(z.object({ name: z.string(), passed: z.boolean() }).loose()),
    unchecked: z.array(z.string()).optional(),
  }),
})

// the game's own counters per player, under its own names
const playerStatsSchema = z
  .object({
    DamageDealt: z.number(),
    DamageTaken: z.number(),
    KOs: z.number().int(),
    Deaths: z.number().int(),
    Suicides: z.number().int(),
    TeamKOs: z.number().int().optional(),
    Clashes: z.number().int(),
    TotalDodges: z.number().int(),
    AirDodges: z.number().int(),
    TotalJumps: z.number().int(),
    AirJumps: z.number().int(),
    Dashes: z.number().int(),
    DashJumps: z.number().int(),
    TimeInAir: z.number().int(),
    TimeOnGround: z.number().int(),
    TimeOnWall: z.number().int(),
    Score: z.number().int(),
  })
  .loose()

// keys in a player's dump that are not weapons
const notWeapons = new Set(['Loadout', 'Sequence'])

export type LinePlayer = {
  slot: number
  brawlhallaId: number
  name: string
  team: number
  legendId: number
  legendName: string
  damageDealt: number
  damageTaken: number
  kos: number
  deaths: number
  suicides: number
  teamKos: number
  clashes: number
  dodges: number
  airDodges: number
  jumps: number
  airJumps: number
  dashes: number
  dashJumps: number
  timeInAirMs: number
  timeOnGroundMs: number
  timeOnWallMs: number
  score: number
  weapons: Record<string, Record<string, number>>
}

export type LineMatch = {
  mapId: number
  mapName: string
  modeName: string
  queue: string | null
  isRanked: boolean
  isCustom: boolean
  hasTeams: boolean
  hasTeamDamage: boolean
  stocks: number | null
  durationMs: number
  firstKoStep: number | null
}

export type FailedLine = { played: false; exit: number }

export type PlayedLine = {
  played: true
  exit: 0
  patch: string
  format: 1
  match: LineMatch
  players: LinePlayer[]
  reliability: { isReliable: boolean; failedChecks: string[]; unchecked: string[] }
}

export type ParsedLine = FailedLine | PlayedLine

/** Throws UnknownFormatError for a line shape this code doesn't know, and a zod error for a malformed one. */
export function parseReplayLine(json: string): ParsedLine {
  const raw: unknown = JSON.parse(json)
  const failed = errorLineSchema.safeParse(raw)

  if (failed.success) return { played: false, exit: failed.data.exit }

  const format = (raw as { format?: unknown }).format

  if (format !== SUPPORTED_FORMAT) throw new UnknownFormatError(`replay line format ${String(format)} isn't supported`)

  const line = okLineSchema.parse(raw)

  return {
    played: true,
    exit: 0,
    patch: line.patch,
    format: SUPPORTED_FORMAT,
    match: toMatch(line),
    players: line.match.players.map((player) => toPlayer(player, line.stats[`Player${player.slot}`])),
    reliability: {
      isReliable: line.reliability.isReliable,
      failedChecks: line.reliability.checks.filter((check) => !check.passed).map((check) => check.name),
      unchecked: line.reliability.unchecked ?? [],
    },
  }
}

function toMatch(line: z.infer<typeof okLineSchema>): LineMatch {
  const firstKo = line.timeline?.events.find((event) => event.type === 'ko')

  return {
    mapId: line.match.map.id,
    mapName: line.match.map.name,
    modeName: line.match.rules.mode.name,
    queue: line.match.rules.queue ?? null,
    isRanked: line.match.rules.isRanked,
    isCustom: line.match.rules.isCustom,
    hasTeams: line.match.rules.hasTeams,
    hasTeamDamage: line.match.rules.hasTeamDamage,
    stocks: line.match.rules.stocks ?? null,
    durationMs: line.stats.GameDuration,
    firstKoStep: firstKo?.step ?? null,
  }
}

function toPlayer(player: z.infer<typeof okLineSchema>['match']['players'][number], dump: unknown): LinePlayer {
  const stats = playerStatsSchema.parse(dump)

  return {
    slot: player.slot,
    brawlhallaId: player.brawlhallaId,
    name: player.name,
    team: player.team,
    legendId: player.legend.id,
    legendName: player.legend.name,
    damageDealt: stats.DamageDealt,
    damageTaken: stats.DamageTaken,
    kos: stats.KOs,
    deaths: stats.Deaths,
    suicides: stats.Suicides,
    teamKos: stats.TeamKOs ?? 0,
    clashes: stats.Clashes,
    dodges: stats.TotalDodges,
    airDodges: stats.AirDodges,
    jumps: stats.TotalJumps,
    airJumps: stats.AirJumps,
    dashes: stats.Dashes,
    dashJumps: stats.DashJumps,
    timeInAirMs: stats.TimeInAir,
    timeOnGroundMs: stats.TimeOnGround,
    timeOnWallMs: stats.TimeOnWall,
    score: stats.Score,
    weapons: weaponsOf(stats),
  }
}

function weaponsOf(stats: Record<string, unknown>): Record<string, Record<string, number>> {
  const weapons: Record<string, Record<string, number>> = {}

  for (const [key, value] of Object.entries(stats)) {
    if (notWeapons.has(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue

    weapons[key] = Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
    )
  }

  return weapons
}

/**
 * What two players' recordings of one match should share: who played, where, how long, and when the first KO
 * fell. Not proven on a real pair yet, so it's only stored to find duplicates later, never to merge.
 */
export function candidateKey(line: PlayedLine): string {
  const players = line.players.map((player) => player.brawlhallaId).sort((a, b) => a - b)
  const parts = [players.join(','), line.match.mapId, line.match.durationMs, line.match.firstKoStep ?? '']

  return createHash('sha256').update(parts.join('|')).digest('hex')
}
