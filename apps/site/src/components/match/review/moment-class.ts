import type { MomentClass } from '@brawltome/contracts'
import { BIG_PUNISH_DAMAGE, EARLY_KO_DAMAGE } from '@brawltome/contracts/match-insights-rules'

// the classes the insights put each exchange in, as players would name them. each is a rule over what the line
// records, never a judgement of how well it was played

export const classLabels: Record<MomentClass, string> = {
  'team-ko': 'Team KO',
  fall: 'SD',
  'early-ko': 'Early KO',
  ko: 'KO',
  big: 'Big punish',
  trade: 'Trade',
  whiff: 'After a miss',
  swing: 'During a swing',
  dodge: 'After a dodge',
  landing: 'On landing',
  throw: 'Thrown weapon',
  free: 'Clean hit',
}

export const classRules: Record<MomentClass, string> = {
  'team-ko': "A teammate's hit knocked the player out",
  fall: 'The player went out with no enemy credited for it',
  'early-ko': `The player was knocked out under ${EARLY_KO_DAMAGE} damage`,
  ko: `The player was knocked out at ${EARLY_KO_DAMAGE} damage or more`,
  big: `The punish dealt ${BIG_PUNISH_DAMAGE} damage or more`,
  trade: 'Both players hit each other within 0.16 s',
  whiff: 'The first hit landed while the player was in the recovery of an attack that missed',
  swing: 'The first hit landed while the player was in an attack of their own',
  dodge: 'The player dodged at most 0.48 s before the first hit',
  landing: 'The player landed at most 0.13 s before the first hit',
  throw: 'The first hit was a thrown weapon',
  free: 'None of the other rules applied',
}
