import { type LegendReference, normalizeWeaponName } from '@brawltome/game-data'
import { type LifetimeEvidence, validateLifetimeEvidence } from './source'

export const CAREER_WEAPON_USAGE_METHODOLOGY_VERSION = 'career-weapon-usage-v1'
export const CAREER_WEAPON_MIN_PLAYER_HELD_SECONDS = 30 * 60
export const CAREER_WEAPON_MIN_CONTRIBUTORS = 30
export const CAREER_WEAPON_MIN_AGGREGATE_HELD_SECONDS = 30 * 60 * 60

export type CareerWeaponExactRatio = { numerator: string; denominator: string }

export type CareerWeaponComparisonReason = 'contributors-below-30' | 'aggregate-held-time-below-30-hours'

export type CareerWeaponUsageValidationCode = 'duplicate-player' | 'unresolved-legend'

export class CareerWeaponUsageValidationError extends Error {
  constructor(
    readonly code: CareerWeaponUsageValidationCode,
    readonly subjectId: number,
  ) {
    super(
      `Career Weapon Usage contains ${code === 'duplicate-player' ? 'duplicate player' : 'unresolved legend'} ${subjectId}`,
    )
  }
}

export type CareerWeaponUsageRow = {
  weapon: string
  observedPlayers: number
  prevalence: CareerWeaponExactRatio | null
  heldTimeSeconds: string
  heldTimeShare: CareerWeaponExactRatio | null
  contributorCount: number
  qualifyingHeldSeconds: string
  medianDamagePerMinute: CareerWeaponExactRatio | null
  medianKosPerHour: CareerWeaponExactRatio | null
  comparison: {
    eligible: boolean
    reasons: CareerWeaponComparisonReason[]
  }
}

export type CareerWeaponUsageAggregate = {
  selectedPlayers: number
  successfulObservations: number
  coverage: CareerWeaponExactRatio | null
  totalHeldSeconds: string
  rows: CareerWeaponUsageRow[]
}

type WeaponTotals = {
  heldSeconds: bigint
  damage: bigint
  kos: bigint
}

type WeaponAggregate = WeaponTotals & {
  observedPlayers: number
  contributors: WeaponTotals[]
}

function nonnegativeCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`)
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

export function exactRatio(numerator: bigint, denominator: bigint): CareerWeaponExactRatio {
  if (denominator <= 0n) throw new Error('exact ratio denominator must be positive')
  const divisor = greatestCommonDivisor(numerator, denominator)
  return {
    numerator: String(numerator / divisor),
    denominator: String(denominator / divisor),
  }
}

function compareRatios(left: CareerWeaponExactRatio, right: CareerWeaponExactRatio): number {
  const difference =
    BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator)
  return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

function median(values: readonly CareerWeaponExactRatio[]): CareerWeaponExactRatio {
  if (values.length === 0) throw new Error('median requires at least one value')
  const sorted = [...values].sort(compareRatios)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[middle - 1]
  return exactRatio(
    BigInt(lower.numerator) * BigInt(upper.denominator) + BigInt(upper.numerator) * BigInt(lower.denominator),
    2n * BigInt(lower.denominator) * BigInt(upper.denominator),
  )
}

function addSlot(target: Map<string, WeaponTotals>, weapon: string, held: number, damage: number, kos: number): void {
  const current = target.get(weapon) ?? { heldSeconds: 0n, damage: 0n, kos: 0n }
  current.heldSeconds += BigInt(held)
  current.damage += BigInt(damage)
  current.kos += BigInt(kos)
  target.set(weapon, current)
}

function legendIndex(references: readonly LegendReference[]): {
  byId: ReadonlyMap<number, { weaponOne: string; weaponTwo: string }>
  weapons: string[]
} {
  const byId = new Map<number, { weaponOne: string; weaponTwo: string }>()
  const weapons = new Set<string>()
  for (const reference of references) {
    if (byId.has(reference.legendId)) throw new Error(`duplicate legend reference ${reference.legendId}`)
    const weaponOne = normalizeWeaponName(reference.weaponOne)
    const weaponTwo = normalizeWeaponName(reference.weaponTwo)
    if (!weaponOne || !weaponTwo) continue
    byId.set(reference.legendId, { weaponOne, weaponTwo })
    weapons.add(weaponOne)
    weapons.add(weaponTwo)
  }
  return { byId, weapons: [...weapons].sort((left, right) => left.localeCompare(right)) }
}

export function aggregateCareerWeaponUsage(input: {
  selectedPlayers: number
  observations: readonly LifetimeEvidence[]
  legendReferences: readonly LegendReference[]
}): CareerWeaponUsageAggregate {
  nonnegativeCount(input.selectedPlayers, 'selectedPlayers')
  if (input.observations.length > input.selectedPlayers) {
    throw new Error('successful observations must not exceed selected players')
  }

  const references = legendIndex(input.legendReferences)
  const aggregates = new Map<string, WeaponAggregate>(
    references.weapons.map((weapon) => [
      weapon,
      { heldSeconds: 0n, damage: 0n, kos: 0n, observedPlayers: 0, contributors: [] },
    ]),
  )
  const playerIds = new Set<number>()

  for (const rawObservation of input.observations) {
    const observation = validateLifetimeEvidence(rawObservation, rawObservation.brawlhallaId)
    if (playerIds.has(observation.brawlhallaId)) {
      throw new CareerWeaponUsageValidationError('duplicate-player', observation.brawlhallaId)
    }
    playerIds.add(observation.brawlhallaId)

    const playerWeapons = new Map<string, WeaponTotals>()
    for (const legend of observation.legends) {
      const reference = references.byId.get(legend.legendId)
      if (!reference) throw new CareerWeaponUsageValidationError('unresolved-legend', legend.legendId)
      addSlot(playerWeapons, reference.weaponOne, legend.timeHeldWeaponOne, legend.damageWeaponOne, legend.koWeaponOne)
      addSlot(playerWeapons, reference.weaponTwo, legend.timeHeldWeaponTwo, legend.damageWeaponTwo, legend.koWeaponTwo)
    }

    for (const [weapon, player] of playerWeapons) {
      const aggregate = aggregates.get(weapon)
      if (!aggregate) throw new Error(`Career Weapon Usage contains unresolved weapon ${weapon}`)
      aggregate.heldSeconds += player.heldSeconds
      aggregate.damage += player.damage
      aggregate.kos += player.kos
      if (player.heldSeconds > 0n) aggregate.observedPlayers += 1
      if (player.heldSeconds >= BigInt(CAREER_WEAPON_MIN_PLAYER_HELD_SECONDS)) {
        aggregate.contributors.push(player)
      }
    }
  }

  const totalHeldSeconds = [...aggregates.values()].reduce((total, weapon) => total + weapon.heldSeconds, 0n)
  const successfulObservations = input.observations.length
  return {
    selectedPlayers: input.selectedPlayers,
    successfulObservations,
    coverage:
      input.selectedPlayers > 0 ? exactRatio(BigInt(successfulObservations), BigInt(input.selectedPlayers)) : null,
    totalHeldSeconds: String(totalHeldSeconds),
    rows: [...aggregates].map(([weapon, aggregate]) => {
      const qualifyingHeldSeconds = aggregate.contributors.reduce(
        (total, contributor) => total + contributor.heldSeconds,
        0n,
      )
      const reasons: CareerWeaponComparisonReason[] = []
      if (aggregate.contributors.length < CAREER_WEAPON_MIN_CONTRIBUTORS) reasons.push('contributors-below-30')
      if (aggregate.heldSeconds < BigInt(CAREER_WEAPON_MIN_AGGREGATE_HELD_SECONDS)) {
        reasons.push('aggregate-held-time-below-30-hours')
      }
      const eligible = reasons.length === 0
      return {
        weapon,
        observedPlayers: aggregate.observedPlayers,
        prevalence:
          successfulObservations > 0
            ? exactRatio(BigInt(aggregate.observedPlayers), BigInt(successfulObservations))
            : null,
        heldTimeSeconds: String(aggregate.heldSeconds),
        heldTimeShare: totalHeldSeconds > 0n ? exactRatio(aggregate.heldSeconds, totalHeldSeconds) : null,
        contributorCount: aggregate.contributors.length,
        qualifyingHeldSeconds: String(qualifyingHeldSeconds),
        medianDamagePerMinute: eligible
          ? median(aggregate.contributors.map(({ damage, heldSeconds }) => exactRatio(damage * 60n, heldSeconds)))
          : null,
        medianKosPerHour: eligible
          ? median(aggregate.contributors.map(({ kos, heldSeconds }) => exactRatio(kos * 3_600n, heldSeconds)))
          : null,
        comparison: { eligible, reasons },
      }
    }),
  }
}
