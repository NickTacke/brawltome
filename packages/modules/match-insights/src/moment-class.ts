import type { Knockout, Lead, MomentClass } from '@brawltome/contracts'

// the class of an exchange. each is a rule over what the line records, never a judgement of how well it was played

// a KO below this damage came early. a punish from 30 damage up is a big one: about a signature or a two or three
// hit string, roughly one punish in eight across the sample replays
export const earlyKoDamage = 100
export const bigDamage = 30

type Classified = { lead: Lead | null; knockout: Knockout | null; damage: number }

/** One class per exchange: a KO or a big punish says more than how it began, so those come first. */
export function classOf(moment: Classified): MomentClass {
  if (!moment.lead) return moment.knockout?.isByTeammate ? 'team-ko' : 'fall'

  if (moment.knockout && moment.knockout.damage < earlyKoDamage) return 'early-ko'

  if (moment.knockout) return 'ko'

  if (moment.damage >= bigDamage) return 'big'

  return moment.lead.kind
}
