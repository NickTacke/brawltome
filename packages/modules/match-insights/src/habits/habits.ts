import type { Habit } from '@brawltome/contracts'
import type { MatchFacts } from '../facts'
import { airHabit } from './air-habit'
import { openerHabit, signatureHabit, swingHabit } from './attack-habits'
import { dodgeAfterHitHabit, dodgeDirectionHabit, dodgeTimingHabit } from './dodge-habits'
import { afterDodgeHabit, afterHitHabit, landingHabit } from './reaction-habits'

/** Every habit of one player, in the order the page lists them by default. */
export function readHabits(facts: MatchFacts, slot: number): Habit[] {
  return [
    afterHitHabit(facts, slot),
    dodgeAfterHitHabit(facts, slot),
    dodgeDirectionHabit(facts, slot),
    dodgeTimingHabit(facts, slot),
    afterDodgeHabit(facts, slot),
    landingHabit(facts, slot),
    airHabit(facts, slot),
    openerHabit(facts, slot),
    swingHabit(facts, slot),
    signatureHabit(facts, slot),
  ]
}
