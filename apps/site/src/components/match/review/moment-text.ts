import type { Lead, Moment, MomentHit } from '@brawltome/contracts'
import { formatDamage } from '../match-format'
import { knockoutMove, zoneNames } from './knockout-text'
import { weaponMoveCode } from './move-notation'

// a moment in words: only what the line records, kept as short as players would say it

const afterMovement: Record<string, string> = {
  jumped: 'after a jump',
  dashed: 'after a dash',
  'threw a weapon': 'after a throw',
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`
}

/** True for the first hit and for every hit with another weapon than the one before, where the weapon is shown. */
export function changesWeapon(hits: MomentHit[], index: number): boolean {
  return index === 0 || hits[index]?.weapon !== hits[index - 1]?.weapon
}

function dodgeLine(lead: Lead): string {
  const dodge = lead.action === 'on the spot' ? 'Spot dodged' : `Dodged ${lead.action}`

  // the one timing that matters: how soon after the dodge the hit came
  return lead.beforeMs === null ? dodge : `${dodge}, hit ${seconds(lead.beforeMs)} later`
}

function freeLine(lead: Lead): string {
  const place = lead.wasInAir ? 'In the air' : 'On the ground'
  const movement = afterMovement[lead.action ?? '']

  return movement ? `${place} ${movement}` : place
}

/** What the player who got hit was doing when the first hit landed, as a player would put it. */
export function leadEvidence(lead: Lead | null): string {
  if (!lead) return ''

  if (lead.kind === 'throw') return 'Hit by a throw'

  if (lead.kind === 'trade') return 'Traded hits'

  if (lead.kind === 'landing') return 'Caught landing'

  if (lead.kind === 'whiff') return `Whiffed ${weaponMoveCode(lead.action ?? 'an attack')}`

  if (lead.kind === 'swing') return `Caught mid ${weaponMoveCode(lead.action ?? 'attack')}`

  if (lead.kind === 'dodge') return dodgeLine(lead)

  return freeLine(lead)
}

/**
 * How a KO went: where they went out and at what. A KO the game credits with no punish behind it has no hits on the
 * card, so its move comes first; an SD's or a team KO's class already says what happened.
 */
export function knockoutFacts(moment: Moment): string {
  const { knockout } = moment

  if (!knockout) return ''

  const out = `${zoneNames[knockout.zone]} at ${formatDamage(knockout.damage)}`
  const hasOwnMove = moment.hits.length === 0 && knockout.move !== null && !knockout.isByTeammate

  return hasOwnMove ? `${knockoutMove(knockout)} · ${out}` : out
}

/** How the moment began and how a KO went, as the line records them. */
export function momentBeginning(moment: Moment): string {
  return [leadEvidence(moment.lead), knockoutFacts(moment)].filter(Boolean).join(' · ')
}
