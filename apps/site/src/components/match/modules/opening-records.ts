import type { LeadKind, Moment } from '@brawltome/contracts'
import { classLabels } from '../review/moment-class'

// a player's openings by how they began, in the same words a review's stops are named with
export type OpeningRecord = {
  kind: LeadKind
  label: string
  // the exchanges that began this way: the ones the player landed, and the ones landed on them
  won: Moment[]
  lost: Moment[]
  damageWon: number
  damageLost: number
}

// every way an opening can begin, in the order the lists show a tie; a record, so a kind the insights add and this
// leaves out fails to compile
const everyKind = {
  free: true,
  swing: true,
  whiff: true,
  dodge: true,
  landing: true,
  trade: true,
  throw: true,
} satisfies Record<LeadKind, true>

const kinds = Object.keys(everyKind) as LeadKind[]

function damageOf(moments: Moment[]): number {
  return moments.reduce((total, moment) => total + moment.damage, 0)
}

/** Every way an opening began, with the player's exchanges of that kind both ways round. */
export function readOpeningRecords(moments: Moment[], slot: number): OpeningRecord[] {
  return kinds.map((kind) => {
    const ofKind = moments.filter((moment) => moment.lead?.kind === kind)
    const won = ofKind.filter((moment) => moment.attacker === slot)
    const lost = ofKind.filter((moment) => moment.victim === slot)

    return { kind, label: classLabels[kind], won, lost, damageWon: damageOf(won), damageLost: damageOf(lost) }
  })
}
