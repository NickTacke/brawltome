import type { Moment, ReviewScope, ReviewStop } from '@brawltome/contracts'
import { bigDamage } from './moment-class'

// what a review of one player's match can step through; each scope is a plain filter over the moments

const scopeRules: [ReviewScope, (moment: Moment, slot: number) => boolean][] = [
  // the short review first: the KOs and heavy punishes on either side
  ['key', (moment, slot) => isInvolved(moment, slot) && (moment.knockout !== null || moment.damage >= bigDamage)],
  ['taken', (moment, slot) => moment.victim === slot],
  ['dealt', (moment, slot) => moment.attacker === slot],
  ['kos', (moment) => moment.knockout !== null],
]

function isInvolved(moment: Moment, slot: number): boolean {
  return moment.victim === slot || moment.attacker === slot
}

export function readReviewStops(moments: Moment[], slots: number[]): ReviewStop[] {
  return slots.flatMap((slot) =>
    scopeRules.flatMap(([scope, isIncluded]) =>
      moments
        .filter((moment) => isIncluded(moment, slot))
        .map((moment) => ({ slot, scope, momentKey: moment.key, timeMs: moment.timeMs })),
    ),
  )
}
