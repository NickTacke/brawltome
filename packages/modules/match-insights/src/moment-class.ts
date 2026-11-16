import { BIG_PUNISH_DAMAGE, EARLY_KO_DAMAGE, type Knockout, type Lead, type MomentClass } from '@brawltome/contracts'

// the class of an exchange. each is a rule over what the line records, never a judgement of how well it was played

type Classified = { lead: Lead | null; knockout: Knockout | null; damage: number }

/** Whether the game credits the KO to someone other than the victim. */
export function hasKiller(knockout: Knockout): boolean {
  return knockout.killer !== null && knockout.killer !== knockout.victim
}

// with no punish behind a KO, the game's own credit still says who killed whom: a fall is a KO it credits to nobody
function unpunishedClass(knockout: Knockout | null): MomentClass {
  if (!knockout || !hasKiller(knockout)) return 'fall'

  if (knockout.isByTeammate) return 'team-ko'

  return knockout.damage < EARLY_KO_DAMAGE ? 'early-ko' : 'ko'
}

/** One class per exchange: a KO or a big punish says more than how it began, so those come first. */
export function classOf(moment: Classified): MomentClass {
  if (!moment.lead) return unpunishedClass(moment.knockout)

  if (moment.knockout && moment.knockout.damage < EARLY_KO_DAMAGE) return 'early-ko'

  if (moment.knockout) return 'ko'

  if (moment.damage >= BIG_PUNISH_DAMAGE) return 'big'

  return moment.lead.kind
}
