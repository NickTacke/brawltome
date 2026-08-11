type SourceRecord = Record<string, unknown>

const MAX_LEGENDS = 100

function record(value: unknown, path: string): SourceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as SourceRecord
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${path} must be a non-negative safe integer`)
  return value as number
}

function positiveInteger(value: unknown, path: string): number {
  const result = integer(value, path)
  if (result === 0) throw new Error(`${path} must be positive`)
  return result
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || !/[^\p{Separator}\p{Format}]/u.test(value)) {
    throw new Error(`${path} must contain visible text`)
  }
  return value
}

function array(value: unknown, path: string, maximumLength?: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  if (maximumLength !== undefined && value.length > maximumLength) {
    throw new Error(`${path} must contain at most ${maximumLength} entries`)
  }
  return value
}

function player(source: SourceRecord, requestedBrawlhallaId: number, path: string): number {
  const brawlhallaId = positiveInteger(source.brawlhalla_id, `${path}.brawlhalla_id`)
  if (brawlhallaId !== requestedBrawlhallaId) throw new Error(`${path} has an unexpected player ID`)
  text(source.name, `${path}.name`)
  for (const forbidden of ['teams', 'team', 'guild', 'clan']) {
    if (forbidden in source) throw new Error(`${path} cannot contain ${forbidden} data`)
  }
  return brawlhallaId
}

function gamesAndWins(source: SourceRecord, path: string) {
  const games = integer(source.games, `${path}.games`)
  const wins = integer(source.wins, `${path}.wins`)
  if (wins > games) throw new Error(`${path}.wins cannot exceed games`)
  return { games, wins }
}

export type RankedEvidence = {
  brawlhallaId: number
  games: number
  wins: number
  rating: number
  peakRating: number
  tier: string
  region: string
  legends: Array<{
    legendId: number
    games: number
    wins: number
    rating: number
    peakRating: number
    tier: string
  }>
}

export function decodeRankedEvidence(payload: unknown, requestedBrawlhallaId: number): RankedEvidence {
  const source = record(payload, 'ranked evidence')
  const brawlhallaId = player(source, requestedBrawlhallaId, 'ranked evidence')
  array(source.region_ranks, 'ranked evidence.region_ranks')
  const legendIds = new Set<number>()
  const legends = array(source.legends, 'ranked evidence.legends', MAX_LEGENDS).map((value, index) => {
    const path = `ranked evidence.legends[${index}]`
    const legend = record(value, path)
    const legendId = positiveInteger(legend.legend_id, `${path}.legend_id`)
    if (legendIds.has(legendId)) throw new Error(`ranked evidence contains duplicate legend ${legendId}`)
    legendIds.add(legendId)
    return {
      legendId,
      ...gamesAndWins(legend, path),
      rating: integer(legend.rating, `${path}.rating`),
      peakRating: integer(legend.peak_rating, `${path}.peak_rating`),
      tier: text(legend.tier, `${path}.tier`),
    }
  })
  return {
    brawlhallaId,
    ...gamesAndWins(source, 'ranked evidence'),
    rating: integer(source.rating, 'ranked evidence.rating'),
    peakRating: integer(source.peak_rating, 'ranked evidence.peak_rating'),
    tier: text(source.tier, 'ranked evidence.tier'),
    region: text(source.region, 'ranked evidence.region'),
    legends,
  }
}

const lifetimeCombatFields = [
  'damage_bomb',
  'damage_mine',
  'damage_spikeball',
  'damage_sidekick',
  'hit_snowball',
  'ko_bomb',
  'ko_mine',
  'ko_sidekick',
  'ko_snowball',
  'ko_spikeball',
] as const

const lifetimeLegendFields = [
  'damage_dealt',
  'damage_taken',
  'kos',
  'falls',
  'suicides',
  'team_kos',
  'match_time',
  'damage_unarmed',
  'damage_thrown_item',
  'damage_weapon_one',
  'damage_weapon_two',
  'damage_gadgets',
  'ko_unarmed',
  'ko_weapon_one',
  'ko_weapon_two',
  'ko_gadgets',
  'time_held_weapon_one',
  'time_held_weapon_two',
] as const

export type LifetimeEvidence = {
  brawlhallaId: number
  games: number
  wins: number
  combat: Record<(typeof lifetimeCombatFields)[number], number>
  legends: Array<{
    legendId: number
    games: number
    wins: number
    damageDealt: number
    damageTaken: number
    kos: number
    falls: number
    suicides: number
    teamKos: number
    matchTime: number
    damageUnarmed: number
    damageThrownItem: number
    damageWeaponOne: number
    damageWeaponTwo: number
    damageGadgets: number
    koUnarmed: number
    koWeaponOne: number
    koWeaponTwo: number
    koGadgets: number
    timeHeldWeaponOne: number
    timeHeldWeaponTwo: number
  }>
}

export function decodeLifetimeEvidence(payload: unknown, requestedBrawlhallaId: number): LifetimeEvidence {
  const source = record(payload, 'lifetime evidence')
  const brawlhallaId = player(source, requestedBrawlhallaId, 'lifetime evidence')
  array(source.region_ranks, 'lifetime evidence.region_ranks')
  const combat = Object.fromEntries(
    lifetimeCombatFields.map((field) => [field, integer(source[field], `lifetime evidence.${field}`)]),
  ) as LifetimeEvidence['combat']
  const legendIds = new Set<number>()
  const legends = array(source.legends, 'lifetime evidence.legends', MAX_LEGENDS).map((value, index) => {
    const path = `lifetime evidence.legends[${index}]`
    const legend = record(value, path)
    const legendId = positiveInteger(legend.legend_id, `${path}.legend_id`)
    if (legendIds.has(legendId)) throw new Error(`lifetime evidence contains duplicate legend ${legendId}`)
    legendIds.add(legendId)
    const facts = Object.fromEntries(
      lifetimeLegendFields.map((field) => [field, integer(legend[field], `${path}.${field}`)]),
    ) as Record<(typeof lifetimeLegendFields)[number], number>
    return {
      legendId,
      ...gamesAndWins(legend, path),
      damageDealt: facts.damage_dealt,
      damageTaken: facts.damage_taken,
      kos: facts.kos,
      falls: facts.falls,
      suicides: facts.suicides,
      teamKos: facts.team_kos,
      matchTime: facts.match_time,
      damageUnarmed: facts.damage_unarmed,
      damageThrownItem: facts.damage_thrown_item,
      damageWeaponOne: facts.damage_weapon_one,
      damageWeaponTwo: facts.damage_weapon_two,
      damageGadgets: facts.damage_gadgets,
      koUnarmed: facts.ko_unarmed,
      koWeaponOne: facts.ko_weapon_one,
      koWeaponTwo: facts.ko_weapon_two,
      koGadgets: facts.ko_gadgets,
      timeHeldWeaponOne: facts.time_held_weapon_one,
      timeHeldWeaponTwo: facts.time_held_weapon_two,
    }
  })
  return { brawlhallaId, ...gamesAndWins(source, 'lifetime evidence'), combat, legends }
}

export function validateRankedEvidence(evidence: unknown, requestedBrawlhallaId: number): RankedEvidence {
  const value = record(evidence, 'ranked evidence')
  const brawlhallaId = positiveInteger(value.brawlhallaId, 'ranked evidence.brawlhallaId')
  if (brawlhallaId !== requestedBrawlhallaId) throw new Error('ranked evidence has an unexpected player ID')
  const legendIds = new Set<number>()
  const legends = array(value.legends, 'ranked evidence.legends', MAX_LEGENDS).map((entry, index) => {
    const path = `ranked evidence.legends[${index}]`
    const legend = record(entry, path)
    const legendId = positiveInteger(legend.legendId, `${path}.legendId`)
    if (legendIds.has(legendId)) throw new Error(`ranked evidence contains duplicate legend ${legendId}`)
    legendIds.add(legendId)
    return {
      legendId,
      ...gamesAndWins(legend, path),
      rating: integer(legend.rating, `${path}.rating`),
      peakRating: integer(legend.peakRating, `${path}.peakRating`),
      tier: text(legend.tier, `${path}.tier`),
    }
  })
  return {
    brawlhallaId,
    ...gamesAndWins(value, 'ranked evidence'),
    rating: integer(value.rating, 'ranked evidence.rating'),
    peakRating: integer(value.peakRating, 'ranked evidence.peakRating'),
    tier: text(value.tier, 'ranked evidence.tier'),
    region: text(value.region, 'ranked evidence.region'),
    legends,
  }
}

export function validateLifetimeEvidence(evidence: unknown, requestedBrawlhallaId: number): LifetimeEvidence {
  const value = record(evidence, 'lifetime evidence')
  const brawlhallaId = positiveInteger(value.brawlhallaId, 'lifetime evidence.brawlhallaId')
  if (brawlhallaId !== requestedBrawlhallaId) throw new Error('lifetime evidence has an unexpected player ID')
  const combatValue = record(value.combat, 'lifetime evidence.combat')
  const combat = Object.fromEntries(
    lifetimeCombatFields.map((field) => [field, integer(combatValue[field], `lifetime evidence.combat.${field}`)]),
  ) as LifetimeEvidence['combat']
  const legendIds = new Set<number>()
  const legends = array(value.legends, 'lifetime evidence.legends', MAX_LEGENDS).map((entry, index) => {
    const path = `lifetime evidence.legends[${index}]`
    const legend = record(entry, path)
    const legendId = positiveInteger(legend.legendId, `${path}.legendId`)
    if (legendIds.has(legendId)) throw new Error(`lifetime evidence contains duplicate legend ${legendId}`)
    legendIds.add(legendId)
    return {
      legendId,
      ...gamesAndWins(legend, path),
      damageDealt: integer(legend.damageDealt, `${path}.damageDealt`),
      damageTaken: integer(legend.damageTaken, `${path}.damageTaken`),
      kos: integer(legend.kos, `${path}.kos`),
      falls: integer(legend.falls, `${path}.falls`),
      suicides: integer(legend.suicides, `${path}.suicides`),
      teamKos: integer(legend.teamKos, `${path}.teamKos`),
      matchTime: integer(legend.matchTime, `${path}.matchTime`),
      damageUnarmed: integer(legend.damageUnarmed, `${path}.damageUnarmed`),
      damageThrownItem: integer(legend.damageThrownItem, `${path}.damageThrownItem`),
      damageWeaponOne: integer(legend.damageWeaponOne, `${path}.damageWeaponOne`),
      damageWeaponTwo: integer(legend.damageWeaponTwo, `${path}.damageWeaponTwo`),
      damageGadgets: integer(legend.damageGadgets, `${path}.damageGadgets`),
      koUnarmed: integer(legend.koUnarmed, `${path}.koUnarmed`),
      koWeaponOne: integer(legend.koWeaponOne, `${path}.koWeaponOne`),
      koWeaponTwo: integer(legend.koWeaponTwo, `${path}.koWeaponTwo`),
      koGadgets: integer(legend.koGadgets, `${path}.koGadgets`),
      timeHeldWeaponOne: integer(legend.timeHeldWeaponOne, `${path}.timeHeldWeaponOne`),
      timeHeldWeaponTwo: integer(legend.timeHeldWeaponTwo, `${path}.timeHeldWeaponTwo`),
    }
  })
  return { brawlhallaId, ...gamesAndWins(value, 'lifetime evidence'), combat, legends }
}
