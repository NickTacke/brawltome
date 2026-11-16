import type { InsightSummary, SummaryKo, SummaryPlayer } from '@brawltome/contracts'
import type { LinePlayer } from './line'
import { readMoveRows, readWeaponRows } from './moves'
import { type MatchRecord, sideOf, statsOf, toMs } from './record'
import { isWinningSide, readSideResult, type SideResult } from './sides'

// the game's own counters per player, with the few shares and rates the page shows beside them

function readKos(record: MatchRecord): SummaryKo[] {
  return record.events.flatMap((event): SummaryKo[] =>
    event.type === 'ko'
      ? [{ timeMs: toMs(record, event.step), victim: event.player, killer: event.killer, damage: event.damage }]
      : [],
  )
}

function dodgeDirections(record: MatchRecord, slot: number): Record<string, number> {
  const directions: Record<string, number> = {}

  for (const event of record.events) {
    if (event.type !== 'dodge' || event.player !== slot) continue

    const direction = event.direction || 'spot'

    directions[direction] = (directions[direction] ?? 0) + 1
  }

  return directions
}

function perMinute(record: MatchRecord, value: number): number {
  const minutes = record.durationMs / 60_000

  return minutes > 0 ? value / minutes : 0
}

function legendNames(player: LinePlayer): { legendKey: string; legendName: string } {
  const name = player.legend.name

  return { legendKey: name.toLowerCase(), legendName: name.charAt(0) + name.slice(1).toLowerCase() }
}

function readPlayer(record: MatchRecord, result: SideResult, player: LinePlayer): SummaryPlayer {
  const stats = statsOf(record, player.slot)
  const moves = readMoveRows(stats)
  const directions = dodgeDirections(record, player.slot)
  const dodges = Object.values(directions).reduce((total, count) => total + count, 0)
  const timeTotal = stats.TimeInAir + stats.TimeOnGround + stats.TimeOnWall
  const shareOf = (time: number) => (timeTotal > 0 ? time / timeTotal : 0)
  const side = sideOf(record, player.slot)

  return {
    slot: player.slot,
    brawlhallaId: player.brawlhallaId,
    name: player.name,
    ...legendNames(player),
    side,
    isWinner: isWinningSide(result, side),
    stocksLeft: Math.max(0, (record.line.match.rules.stocks ?? 0) - stats.Deaths),
    score: stats.Score ?? null,
    kos: stats.KOs,
    falls: stats.Deaths,
    damageDealt: stats.DamageDealt,
    damageTaken: stats.DamageTaken,
    attacks: moves.reduce((total, move) => total + move.uses, 0),
    // a multi-hit move counts every hit, so a use counts at most once
    hits: moves.reduce((total, move) => total + Math.min(move.hits, move.uses), 0),
    dodges,
    dodgeDirections: directions,
    airShare: shareOf(stats.TimeInAir),
    groundShare: shareOf(stats.TimeOnGround),
    wallShare: shareOf(stats.TimeOnWall),
    damagePerMinute: perMinute(record, stats.DamageDealt),
    dodgesPerMinute: perMinute(record, dodges),
    damageTakenPerFall: stats.Deaths > 0 ? stats.DamageTaken / stats.Deaths : null,
    weapons: readWeaponRows(stats),
    moves,
  }
}

export function readSummary(record: MatchRecord): InsightSummary {
  const { match } = record.line
  const result = readSideResult(record)

  return {
    mapId: match.map.id,
    mapName: match.map.name,
    modeName: match.rules.mode.name,
    patch: record.line.patch,
    durationMs: record.durationMs,
    players: match.players.map((player) => readPlayer(record, result, player)),
    kos: readKos(record),
  }
}
