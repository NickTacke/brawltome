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

export type AccountPreferencesContract = z.infer<typeof accountPreferencesSchema>
export type AccountContract = z.infer<typeof accountSchema>
export type AccountViewContract = z.infer<typeof accountViewSchema>

export function parseAccountViewOutput(value: unknown): AccountViewContract {
  return accountViewSchema.parse(value)
}
