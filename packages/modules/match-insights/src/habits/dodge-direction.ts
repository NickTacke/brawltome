import type { DodgeEvent } from '../line'
import { nearestEnemy, positionAt } from '../positions'
import type { MatchRecord } from '../record'

// a dodge's direction as the player meant it: towards the nearest enemy or away, rather than left or right

// rows read top to bottom, columns from towards the enemy to away from them, like the pad that draws them
export const directionLabels: Record<string, string> = {
  'up-in': 'Up and in',
  'up-none': 'Up',
  'up-away': 'Up and away',
  'mid-in': 'In',
  'mid-none': 'Spot',
  'mid-away': 'Away',
  'down-in': 'Down and in',
  'down-none': 'Down',
  'down-away': 'Down and away',
}

// null when there is no enemy to dodge towards or away from
function horizontalPart(record: MatchRecord, slot: number, dodge: DodgeEvent): string | null {
  const goesRight = dodge.direction.includes('right')

  if (!goesRight && !dodge.direction.includes('left')) return 'none'

  const enemy = nearestEnemy(record, slot, dodge.step)
  const own = positionAt(record, slot, dodge.step)
  const other = enemy === null ? null : positionAt(record, enemy, dodge.step)

  if (!own || !other) return null

  return goesRight === other.x > own.x ? 'in' : 'away'
}

function verticalPart(dodge: DodgeEvent): string {
  if (dodge.direction.includes('up')) return 'up'

  return dodge.direction.includes('down') ? 'down' : 'mid'
}

/** The key of the pad cell a dodge goes in, or null when its direction can't be told. */
export function directionKey(record: MatchRecord, slot: number, dodge: DodgeEvent): string | null {
  const horizontal = horizontalPart(record, slot, dodge)

  return horizontal === null ? null : `${verticalPart(dodge)}-${horizontal}`
}
