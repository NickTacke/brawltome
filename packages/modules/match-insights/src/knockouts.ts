import type { Knockout, KoZone } from '@brawltome/contracts'
import { kosOf } from './events'
import type { MatchFacts } from './facts'
import type { KoEvent } from './line'
import { type Position, positionAt } from './positions'
import { areEnemies, isLive, type MatchRecord, stateOf, toMs } from './record'
import { valueAt } from './series'

// what was going on at each KO: the move, where the victim went out, and the punish that led to it

const positionSampleSteps = 16

type Centre = Position & { halfWidth: number; halfHeight: number }

// the middle of where players stood while in play, as a stand-in for the stage's centre
function stageCentre(record: MatchRecord): Centre {
  const xs: number[] = []
  const ys: number[] = []

  for (const player of record.players) {
    for (let step = record.startStep; step < record.endStep; step += positionSampleSteps) {
      const position = isLive(record, player.slot, step) ? positionAt(record, player.slot, step) : null

      if (!position) continue

      xs.push(position.x)
      ys.push(position.y)
    }
  }

  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    halfWidth: (maxX - minX) / 2 || 1,
    halfHeight: (maxY - minY) / 2 || 1,
  }
}

function zoneOf(record: MatchRecord, centre: Centre, victim: number, step: number): KoZone {
  const position = positionAt(record, victim, step)

  if (!position) return 'side'

  const across = (position.x - centre.x) / centre.halfWidth
  const down = (position.y - centre.y) / centre.halfHeight

  if (Math.abs(across) >= Math.abs(down)) return 'side'

  // the game's y axis points down
  return down < 0 ? 'top' : 'bottom'
}

function readKnockout(facts: MatchFacts, centre: Centre, event: KoEvent, koIndex: number): Knockout {
  const { record } = facts
  const { player: victim, killer, step } = event

  const blow = facts.blows.findLast(
    (entry) => entry.target === victim && entry.attacker === killer && entry.step <= step,
  )

  const punishIndex = facts.koPunishes[koIndex] ?? null
  const punish = punishIndex === null ? undefined : facts.punishes[punishIndex]
  const state = stateOf(record, victim)
  const hitStep = blow ? blow.step - 1 : step - 1

  return {
    timeMs: toMs(record, step),
    victim,
    killer,
    isByTeammate: killer !== null && killer !== victim && !areEnemies(record, killer, victim),
    damage: event.damage,
    move: blow?.move ?? null,
    weapon: blow?.weapon ?? null,
    zone: zoneOf(record, centre, victim, step),
    punishIndex,
    sinceOpeningMs: punish ? toMs(record, step) - punish.startMs : null,
    airJumpsUsed: valueAt(state.airJumpsUsed, hitStep, 0),
    wasAirborne: valueAt(state.inAir, hitStep, false),
  }
}

export function readKnockouts(facts: MatchFacts): Knockout[] {
  const centre = stageCentre(facts.record)

  return kosOf(facts.record).map((event, koIndex) => readKnockout(facts, centre, event, koIndex))
}
