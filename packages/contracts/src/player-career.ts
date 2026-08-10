import { brawlhallaIdSchema } from './player-reference'
import { z } from './zod'

const int32 = z.int().min(0).max(2_147_483_647).meta({ format: 'int32' })
const positiveInt32 = int32.min(1)
const fraction = z.number().min(0).max(1)
const decimal = z.string().regex(/^(0|[1-9]\d*)$/, 'must be a canonical non-negative decimal string')
const utcDateTime = z.iso
  .datetime({ offset: false })
  .regex(/Z$/, 'date-time must use the UTC Z suffix')
  .meta({ format: 'date-time' })
const visibleText = z
  .string()
  .min(1)
  .refine((value) => /[^\p{Separator}\p{Format}]/u.test(value))

const damageKosSchema = z.object({ damage: decimal, kos: int32 }).strict()
const weaponSlotSchema = damageKosSchema.extend({ heldTime: int32 }).strict()

const careerLegendSchema = z
  .object({
    legendId: positiveInt32,
    legendNameKey: visibleText,
    xp: int32,
    level: int32,
    xpPercentage: fraction,
    games: int32,
    wins: int32,
    matchTime: int32,
    kos: int32,
    falls: int32,
    suicides: int32,
    teamKos: int32,
    damageDealt: decimal,
    damageTaken: decimal,
    unarmed: damageKosSchema,
    thrownItem: damageKosSchema,
    gadgets: damageKosSchema,
    weaponOne: weaponSlotSchema,
    weaponTwo: weaponSlotSchema,
  })
  .strict()
  .refine(({ wins, games }) => wins <= games, { message: 'wins cannot exceed games', path: ['wins'] })

const careerWeaponSchema = z
  .object({
    weapon: visibleText,
    heldTime: int32,
    damage: decimal,
    kos: int32,
  })
  .strict()

const accountSchema = z
  .object({
    xp: int32,
    level: int32,
    xpPercentage: fraction,
  })
  .strict()

const combatSchema = z
  .object({
    games: int32,
    wins: int32,
    matchTime: int32,
    damageBomb: decimal,
    damageMine: decimal,
    damageSpikeball: decimal,
    damageSidekick: decimal,
    snowballHits: int32,
    bombKos: int32,
    mineKos: int32,
    spikeballKos: int32,
    sidekickKos: int32,
    snowballKos: int32,
  })
  .strict()
  .refine(({ wins, games }) => wins <= games, { message: 'wins cannot exceed games', path: ['wins'] })

export const playerCareerSnapshotSchema = z
  .object({
    account: accountSchema,
    combat: combatSchema,
    legends: z.array(careerLegendSchema),
    weapons: z.array(careerWeaponSchema),
  })
  .strict()
  .meta({ id: 'PlayerCareerSnapshot' })

export const playerCareerProfileSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    checkedAt: utcDateTime,
    lastSuccessAt: utcDateTime.nullable(),
    freshness: z.enum(['fresh', 'stale', 'unavailable']),
    freshForSeconds: z.int().min(43_200).max(43_200).meta({ format: 'int32' }),
    snapshot: playerCareerSnapshotSchema.nullable(),
  })
  .strict()
  .superRefine((profile, context) => {
    const unavailable =
      profile.lastSuccessAt === null && profile.freshness === 'unavailable' && profile.snapshot === null
    const available = profile.lastSuccessAt !== null && profile.freshness !== 'unavailable' && profile.snapshot !== null
    if (!unavailable && !available) {
      context.addIssue({ code: 'custom', message: 'career availability fields are inconsistent' })
    }
  })
  .meta({ id: 'PlayerCareerProfile' })

export const nullablePlayerCareerProfileSchema = playerCareerProfileSchema.nullable()
export type PlayerCareerProfileContract = z.infer<typeof playerCareerProfileSchema>

export function parsePlayerCareerProfileOutput(value: unknown): PlayerCareerProfileContract | null {
  return nullablePlayerCareerProfileSchema.parse(value)
}
