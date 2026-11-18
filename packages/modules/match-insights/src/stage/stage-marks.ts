import type { StageBox, StageHit, StageKo, StageMarks, StageSpot, StageTrail } from '@brawltome/contracts'
import { dodgesOf, hitsOf, kosOf } from '../events'
import type { MatchFacts } from '../facts'
import { positionAt } from '../positions'
import { punishIndexOfBlow } from '../punishes'
import { isLive, type MatchRecord, toMs } from '../record'
import { toShare } from './stage-box'

// what the one-map view draws on the stage, each with the time it happened so the view can filter by stock: moves
// that landed, KOs, dodges and where every player was

const trackEverySteps = 8

function spotAt(record: MatchRecord, box: StageBox, slot: number, step: number): StageSpot | null {
  const position = positionAt(record, slot, step)

  if (!position) return null

  return [toMs(record, step), ...toShare(box, position)]
}

function trackOf(record: MatchRecord, box: StageBox, slot: number): StageTrail {
  const spots: StageSpot[] = []

  for (let step = record.startStep; step < record.endStep; step += trackEverySteps) {
    const spot = isLive(record, slot, step) ? spotAt(record, box, slot, step) : null

    if (spot) spots.push(spot)
  }

  return { slot, spots }
}

function dodgeTrailOf(record: MatchRecord, box: StageBox, slot: number): StageTrail {
  const spots = dodgesOf(record, slot).map((dodge) => spotAt(record, box, slot, dodge.step))

  return { slot, spots: spots.filter((spot) => spot !== null) }
}

// one mark per move that landed, where its first hit connected
function stageHits(facts: MatchFacts, box: StageBox): StageHit[] {
  const hits = hitsOf(facts.record)

  return facts.blows.flatMap((blow): StageHit[] => {
    const first = hits.find(
      (hit) => hit.step === blow.step && hit.attacker === blow.attacker && hit.target === blow.target,
    )

    if (!first) return []

    const [x, y] = toShare(box, first)
    const { attacker, target, weapon, move, damage } = blow
    const punishIndex = punishIndexOfBlow(facts.punishes, blow)

    return [{ timeMs: toMs(facts.record, blow.step), x, y, attacker, target, weapon, move, damage, punishIndex }]
  })
}

function stageKos(record: MatchRecord, box: StageBox): StageKo[] {
  return kosOf(record).flatMap((ko): StageKo[] => {
    const spot = spotAt(record, box, ko.player, ko.step)

    return spot ? [{ timeMs: spot[0], victim: ko.player, x: spot[1], y: spot[2] }] : []
  })
}

export function readStageMarks(facts: MatchFacts, box: StageBox): StageMarks {
  const { record } = facts
  const slots = record.players.map((player) => player.slot)

  return {
    hits: stageHits(facts, box),
    kos: stageKos(record, box),
    tracks: slots.map((slot) => trackOf(record, box, slot)),
    dodges: slots.map((slot) => dodgeTrailOf(record, box, slot)),
  }
}
