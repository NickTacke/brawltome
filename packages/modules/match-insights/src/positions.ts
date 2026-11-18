import { areEnemies, isLive, type MatchRecord } from './record'

export type Position = { x: number; y: number }

/** Where a player stood at a step, from the position sample nearest to it. */
export function positionAt(record: MatchRecord, slot: number, step: number): Position | null {
  const track = record.tracks.get(slot)

  if (!track) return null

  const index = Math.round((step - track.from) / record.positionEvery)
  const clamped = Math.min(Math.max(index, 0), track.x.length - 1)
  const x = track.x[clamped]
  const y = track.y[clamped]

  if (x === undefined || y === undefined) return null

  return { x, y }
}

/** The enemy closest to a player at a step, or null when none is in play. */
export function nearestEnemy(record: MatchRecord, slot: number, step: number): number | null {
  const own = positionAt(record, slot, step)
  let nearest: number | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  if (!own) return null

  for (const player of record.players) {
    const other = isLive(record, player.slot, step) ? positionAt(record, player.slot, step) : null

    if (!other || !areEnemies(record, slot, player.slot)) continue

    const distance = Math.hypot(other.x - own.x, other.y - own.y)

    if (distance < nearestDistance) {
      nearest = player.slot
      nearestDistance = distance
    }
  }

  return nearest
}
