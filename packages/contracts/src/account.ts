import { nullablePlayerRankedProfileSchema } from './player-ranked'
import { brawlhallaIdSchema, nullablePlayerReferenceSchema } from './player-reference'
import { z } from './zod'

export const leaderboardBracketPreferenceSchema = z.enum(['1v1', '2v2', 'solo2v2', '3v3'])
export const leaderboardRegionPreferenceSchema = z.enum([
  'all',
  'US-E',
  'US-W',
  'EU',
  'SEA',
  'AUS',
  'BRZ',
  'JPN',
  'ME',
  'SA',
])

export const accountPreferencesSchema = z
  .object({
    version: z.literal(1),
    leaderboardBracket: leaderboardBracketPreferenceSchema,
    leaderboardRegion: leaderboardRegionPreferenceSchema,
  })
  .strict()

export const accountSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().min(1).max(64),
    avatarUrl: z.string().url().nullable(),
    createdAt: z.string().datetime({ offset: false }),
  })
  .strict()

export const anonymousAccountViewSchema = z.object({ status: z.literal('anonymous') }).strict()
export const signedInAccountViewSchema = z
  .object({
    status: z.literal('signedIn'),
    account: accountSchema,
  })
  .strict()

export const accountViewSchema = z.discriminatedUnion('status', [anonymousAccountViewSchema, signedInAccountViewSchema])

const primaryPlayerReferenceSchema = z
  .object({
    brawlhallaId: z.number().int().positive().safe(),
    name: z.string().min(1).max(64).nullable(),
  })
  .strict()

const primaryPlayerSchema = primaryPlayerReferenceSchema
  .extend({ verifiedAt: z.string().datetime({ offset: false }) })
  .strict()

const verificationAttemptBase = {
  id: z.string().uuid(),
  startedAt: z.string().datetime({ offset: false }),
}

const primaryPlayerVerificationAttemptSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...verificationAttemptBase,
      status: z.literal('pending'),
      completedAt: z.null(),
      player: z.null(),
    })
    .strict(),
  z
    .object({
      ...verificationAttemptBase,
      status: z.literal('failed'),
      completedAt: z.string().datetime({ offset: false }),
      player: z.null(),
    })
    .strict(),
  z
    .object({
      ...verificationAttemptBase,
      status: z.literal('conflict'),
      completedAt: z.string().datetime({ offset: false }),
      player: primaryPlayerReferenceSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...verificationAttemptBase,
      status: z.literal('verified'),
      completedAt: z.string().datetime({ offset: false }),
      player: primaryPlayerReferenceSchema,
    })
    .strict(),
])

export const primaryPlayerVerificationStateSchema = z
  .object({
    primaryPlayer: primaryPlayerSchema.nullable(),
    attempts: z.array(primaryPlayerVerificationAttemptSchema),
  })
  .strict()

const utcDateTime = z.iso
  .datetime({ offset: false })
  .regex(/Z$/, 'date-time must use the UTC Z suffix')
  .meta({ format: 'date-time' })

export const savedPlayerInputSchema = z.object({ brawlhallaId: brawlhallaIdSchema }).strict()

export const MAX_SAVED_PLAYERS = 100
export const MAX_PINNED_PLAYERS = 4

export const savedPlayerOrderInputSchema = z
  .object({ brawlhallaIds: z.array(brawlhallaIdSchema).max(MAX_SAVED_PLAYERS) })
  .strict()
  .refine(
    ({ brawlhallaIds }) => new Set(brawlhallaIds).size === brawlhallaIds.length,
    'Saved Player order cannot contain duplicates',
  )

export const pinnedPlayerOrderInputSchema = z
  .object({ brawlhallaIds: z.array(brawlhallaIdSchema).max(MAX_PINNED_PLAYERS) })
  .strict()
  .refine(
    ({ brawlhallaIds }) => new Set(brawlhallaIds).size === brawlhallaIds.length,
    'Pinned Player order cannot contain duplicates',
  )

export const savedPlayerSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    order: z.int().min(0).max(2_147_483_647),
    pinOrder: z
      .int()
      .min(0)
      .max(MAX_PINNED_PLAYERS - 1)
      .nullable(),
    savedAt: utcDateTime,
    player: nullablePlayerReferenceSchema,
    currentSeason: nullablePlayerRankedProfileSchema,
  })
  .strict()
  .superRefine((savedPlayer, context) => {
    if (savedPlayer.player && savedPlayer.player.brawlhallaId !== savedPlayer.brawlhallaId) {
      context.addIssue({ code: 'custom', message: 'Saved Player reference must match its bookmark' })
    }
    if (savedPlayer.currentSeason && savedPlayer.currentSeason.brawlhallaId !== savedPlayer.brawlhallaId) {
      context.addIssue({ code: 'custom', message: 'Saved Player ranked facts must match its bookmark' })
    }
  })

export const savedPlayersSchema = z.array(savedPlayerSchema).max(MAX_SAVED_PLAYERS)

const shortcutMainLegendSchema = z
  .object({
    legendNameKey: z.string().min(1),
    source: z.enum(['current-season', 'career']),
  })
  .strict()

export const playerShortcutSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    name: z.string().min(1).max(256).nullable(),
    mainLegend: shortcutMainLegendSchema.nullable(),
  })
  .strict()

export const playerShortcutsSchema = z
  .object({
    primary: playerShortcutSchema.nullable(),
    pins: z.array(playerShortcutSchema).max(MAX_PINNED_PLAYERS),
  })
  .strict()
  .superRefine((shortcuts, context) => {
    const ids = shortcuts.pins.map(({ brawlhallaId }) => brawlhallaId)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Pinned shortcuts cannot contain duplicates', path: ['pins'] })
    }
    if (shortcuts.primary && ids.includes(shortcuts.primary.brawlhallaId)) {
      context.addIssue({ code: 'custom', message: 'Primary Player cannot also be pinned', path: ['pins'] })
    }
  })

export type AccountPreferencesContract = z.infer<typeof accountPreferencesSchema>
export type AccountContract = z.infer<typeof accountSchema>
export type AccountViewContract = z.infer<typeof accountViewSchema>
export type PrimaryPlayerVerificationStateContract = z.infer<typeof primaryPlayerVerificationStateSchema>
export type PlayerShortcutContract = z.infer<typeof playerShortcutSchema>
export type PlayerShortcutsContract = z.infer<typeof playerShortcutsSchema>
export type SavedPlayerContract = z.infer<typeof savedPlayerSchema>
export type SavedPlayersContract = z.infer<typeof savedPlayersSchema>

export function parseAccountViewOutput(value: unknown): AccountViewContract {
  return accountViewSchema.parse(value)
}

export function parsePrimaryPlayerVerificationStateOutput(value: unknown): PrimaryPlayerVerificationStateContract {
  return primaryPlayerVerificationStateSchema.parse(value)
}

export function parseSavedPlayersOutput(value: unknown): SavedPlayersContract {
  return savedPlayersSchema.parse(value)
}

export function parsePlayerShortcutsOutput(value: unknown): PlayerShortcutsContract {
  return playerShortcutsSchema.parse(value)
}
