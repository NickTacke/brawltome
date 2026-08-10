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

export type AccountPreferencesContract = z.infer<typeof accountPreferencesSchema>
export type AccountContract = z.infer<typeof accountSchema>
export type AccountViewContract = z.infer<typeof accountViewSchema>
export type PrimaryPlayerVerificationStateContract = z.infer<typeof primaryPlayerVerificationStateSchema>

export function parseAccountViewOutput(value: unknown): AccountViewContract {
  return accountViewSchema.parse(value)
}

export function parsePrimaryPlayerVerificationStateOutput(value: unknown): PrimaryPlayerVerificationStateContract {
  return primaryPlayerVerificationStateSchema.parse(value)
}
