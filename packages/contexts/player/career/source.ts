const INT32_MAX = 2_147_483_647
const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/

type RecordValue = Record<string, unknown>

export type CareerLegendReference = {
  legendId: number
  legendNameKey: string
  weaponOne: string
  weaponTwo: string
}

export type CareerLegendResolver = (legendId: number, legendNameKey: string) => CareerLegendReference | null

export type CareerLegendSnapshot = {
  legendId: number
  legendNameKey: string
  xp: number
  level: number
  xpPercentage: number
  games: number
  wins: number
  matchTime: number
  kos: number
  falls: number
  suicides: number
  teamKos: number
  damageDealt: string
  damageTaken: string
  unarmed: { damage: string; kos: number }
  thrownItem: { damage: string; kos: number }
  gadgets: { damage: string; kos: number }
  weaponOne: { damage: string; kos: number; heldTime: number }
  weaponTwo: { damage: string; kos: number; heldTime: number }
}

export type CareerWeaponSnapshot = {
  weapon: string
  heldTime: number
  damage: string
  kos: number
}

export type V0CareerSnapshot = {
  brawlhallaId: number
  name: string
  guild: { guildId: number; guildName: string } | null
  account: { xp: number; level: number; xpPercentage: number }
  combat: {
    games: number
    wins: number
    matchTime: number
    damageBomb: string
    damageMine: string
    damageSpikeball: string
    damageSidekick: string
    snowballHits: number
    bombKos: number
    mineKos: number
    spikeballKos: number
    sidekickKos: number
    snowballKos: number
  }
  legends: CareerLegendSnapshot[]
  weapons: CareerWeaponSnapshot[]
}

function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as RecordValue
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > INT32_MAX) {
    throw new Error(`${path} must be an integer between ${minimum} and ${INT32_MAX}`)
  }
  return value as number
}

function percentage(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a finite number between 0 and 1`)
  }
  return value
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || !/[^\p{Separator}\p{Format}]/u.test(value)) {
    throw new Error(`${path} must contain visible text`)
  }
  return value
}

function decimal(value: unknown, path: string): string {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${path} must be a canonical non-negative decimal string`)
  }
  return value
}

function checkedSum(values: number[], path: string): number {
  const result = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(result) || result > INT32_MAX)
    throw new Error(`${path} exceeds the supported integer range`)
  return result
}

export function decodeV0CareerSnapshot(
  payload: unknown,
  requestedBrawlhallaId: number,
  resolveLegend: CareerLegendResolver,
): V0CareerSnapshot {
  const source = record(payload, 'career')
  const brawlhallaId = integer(source.brawlhalla_id, 'career.brawlhalla_id', 1)
  if (brawlhallaId !== requestedBrawlhallaId) {
    throw new Error('career.brawlhalla_id does not match the requested player')
  }

  const legendIds = new Set<number>()
  const observedLegendMatchTimes: number[] = []
  const legendEntries = array(source.legends, 'career.legends').flatMap((value, index) => {
    const path = `career.legends[${index}]`
    const legend = record(value, path)
    const legendId = integer(legend.legend_id, `${path}.legend_id`, 1)
    if (legendIds.has(legendId)) throw new Error(`career.legends contains duplicate legend ${legendId}`)
    legendIds.add(legendId)
    const legendNameKey = text(legend.legend_name_key, `${path}.legend_name_key`)
    const games = integer(legend.games, `${path}.games`)
    const wins = integer(legend.wins, `${path}.wins`)
    if (wins > games) throw new Error(`${path}.wins cannot exceed games`)
    const matchTime = integer(legend.matchtime, `${path}.matchtime`)
    observedLegendMatchTimes.push(matchTime)
    const snapshot = {
      legendId,
      legendNameKey,
      xp: integer(legend.xp, `${path}.xp`),
      level: integer(legend.level, `${path}.level`),
      xpPercentage: percentage(legend.xp_percentage, `${path}.xp_percentage`),
      games,
      wins,
      matchTime,
      kos: integer(legend.kos, `${path}.kos`),
      falls: integer(legend.falls, `${path}.falls`),
      suicides: integer(legend.suicides, `${path}.suicides`),
      teamKos: integer(legend.teamkos, `${path}.teamkos`),
      damageDealt: decimal(legend.damagedealt, `${path}.damagedealt`),
      damageTaken: decimal(legend.damagetaken, `${path}.damagetaken`),
      unarmed: {
        damage: decimal(legend.damageunarmed, `${path}.damageunarmed`),
        kos: integer(legend.kounarmed, `${path}.kounarmed`),
      },
      thrownItem: {
        damage: decimal(legend.damagethrownitem, `${path}.damagethrownitem`),
        kos: integer(legend.kothrownitem, `${path}.kothrownitem`),
      },
      gadgets: {
        damage: decimal(legend.damagegadgets, `${path}.damagegadgets`),
        kos: integer(legend.kogadgets, `${path}.kogadgets`),
      },
      weaponOne: {
        damage: decimal(legend.damageweaponone, `${path}.damageweaponone`),
        kos: integer(legend.koweaponone, `${path}.koweaponone`),
        heldTime: integer(legend.timeheldweaponone, `${path}.timeheldweaponone`),
      },
      weaponTwo: {
        damage: decimal(legend.damageweapontwo, `${path}.damageweapontwo`),
        kos: integer(legend.koweapontwo, `${path}.koweapontwo`),
        heldTime: integer(legend.timeheldweapontwo, `${path}.timeheldweapontwo`),
      },
    }
    const reference = resolveLegend(legendId, legendNameKey)
    return !reference || reference.legendId !== legendId || reference.legendNameKey !== legendNameKey
      ? []
      : [{ reference, legend: snapshot }]
  })
  const legends = legendEntries.map(({ legend }) => legend)

  const weaponFacts = new Map<string, { heldTimes: number[]; damage: bigint; kos: number[] }>()
  const addWeapon = (weapon: string, heldTime: number, damage: string, kos: number) => {
    const name = text(weapon, 'career weapon reference')
    const fact = weaponFacts.get(name) ?? { heldTimes: [], damage: 0n, kos: [] }
    fact.heldTimes.push(heldTime)
    fact.damage += BigInt(damage)
    fact.kos.push(kos)
    weaponFacts.set(name, fact)
  }
  for (const { legend, reference } of legendEntries) {
    addWeapon(reference.weaponOne, legend.weaponOne.heldTime, legend.weaponOne.damage, legend.weaponOne.kos)
    addWeapon(reference.weaponTwo, legend.weaponTwo.heldTime, legend.weaponTwo.damage, legend.weaponTwo.kos)
  }
  const weapons = Array.from(weaponFacts, ([weapon, fact]) => ({
    weapon,
    heldTime: checkedSum(fact.heldTimes, `career weapon ${weapon} held time`),
    damage: fact.damage.toString(),
    kos: checkedSum(fact.kos, `career weapon ${weapon} KOs`),
  })).sort((left, right) => right.heldTime - left.heldTime || left.weapon.localeCompare(right.weapon))

  const games = integer(source.games, 'career.games')
  const wins = integer(source.wins, 'career.wins')
  if (wins > games) throw new Error('career.wins cannot exceed games')

  const guildSource = source.clan === undefined || source.clan === null ? null : record(source.clan, 'career.clan')
  const guild = guildSource
    ? {
        guildId: integer(guildSource.clan_id, 'career.clan.clan_id', 1),
        guildName: text(guildSource.clan_name, 'career.clan.clan_name'),
      }
    : null

  return {
    brawlhallaId,
    name: text(source.name, 'career.name'),
    guild,
    account: {
      xp: integer(source.xp, 'career.xp'),
      level: integer(source.level, 'career.level'),
      xpPercentage: percentage(source.xp_percentage, 'career.xp_percentage'),
    },
    combat: {
      games,
      wins,
      matchTime: checkedSum(observedLegendMatchTimes, 'career match time'),
      damageBomb: decimal(source.damagebomb, 'career.damagebomb'),
      damageMine: decimal(source.damagemine, 'career.damagemine'),
      damageSpikeball: decimal(source.damagespikeball, 'career.damagespikeball'),
      damageSidekick: decimal(source.damagesidekick, 'career.damagesidekick'),
      snowballHits: integer(source.hitsnowball, 'career.hitsnowball'),
      bombKos: integer(source.kobomb, 'career.kobomb'),
      mineKos: integer(source.komine, 'career.komine'),
      spikeballKos: integer(source.kospikeball, 'career.kospikeball'),
      sidekickKos: integer(source.kosidekick, 'career.kosidekick'),
      snowballKos: integer(source.kosnowball, 'career.kosnowball'),
    },
    legends,
    weapons,
  }
}
