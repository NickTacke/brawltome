import type { Knockout, Moment, Punish, StageHit } from '@brawltome/contracts'
import type { MatchFacts } from './facts'
import { classOf } from './moment-class'
import { readLead } from './moment-lead'
import { weaponLabel } from './weapon-names'

// the moments of a match to watch back: every punish and KO, with how it began as the line records it

type Sources = { facts: MatchFacts; knockouts: Knockout[]; stageHits: StageHit[] }

function punishMoment(sources: Sources, punish: Punish, index: number): Moment {
  const knockout = sources.knockouts.find((entry) => entry.punishIndex === index) ?? null
  const firstHit = sources.stageHits.find((hit) => hit.punishIndex === index)
  const lead = readLead(sources.facts, punish)

  return {
    key: `punish-${index}`,
    class: classOf({ lead, knockout, damage: punish.damage }),
    timeMs: punish.startMs,
    endMs: Math.max(punish.endMs, knockout?.timeMs ?? punish.endMs),
    attacker: punish.attacker,
    victim: punish.target,
    damage: punish.damage,
    hits: punish.hits.map((hit) => ({
      weapon: hit.weapon,
      name: hit.move,
      move: `${weaponLabel(hit.weapon)} ${hit.move.toLowerCase()}`,
      damage: hit.damage,
    })),
    knockout,
    lead,
    spot: firstHit ? { x: firstHit.x, y: firstHit.y } : null,
  }
}

function fallMoment(knockout: Knockout): Moment {
  return {
    key: `fall-${knockout.victim}-${knockout.timeMs}`,
    class: classOf({ lead: null, knockout, damage: 0 }),
    timeMs: knockout.timeMs,
    endMs: knockout.timeMs,
    // a teammate who sent them out, or nobody: an SD has no one to name
    attacker: knockout.isByTeammate ? knockout.killer : null,
    victim: knockout.victim,
    damage: 0,
    hits: [],
    knockout,
    lead: null,
    spot: null,
  }
}

/** Every punish and KO of a match in the order they happened. */
export function readMoments(sources: Sources): Moment[] {
  const punished = sources.facts.punishes.map((punish, index) => punishMoment(sources, punish, index))
  const falls = sources.knockouts.filter((knockout) => knockout.punishIndex === null).map(fallMoment)

  return [...punished, ...falls].sort((left, right) => left.timeMs - right.timeMs)
}
