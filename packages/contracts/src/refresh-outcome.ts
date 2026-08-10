import { brawlhallaIdSchema, nullablePlayerReferenceSchema } from './player-reference'
import { z } from './zod'

const retryAfterSecondsSchema = z.number().int().min(1).max(86_400).meta({ format: 'int32' })
const pollGuidanceSchema = z
  .object({ kind: z.literal('poll'), afterSeconds: retryAfterSecondsSchema })
  .strict()
  .meta({ id: 'RefreshPollGuidance' })
const noRetryGuidanceSchema = z
  .object({ kind: z.literal('none') })
  .strict()
  .meta({ id: 'RefreshNoRetryGuidance' })
const verifyGuidanceSchema = z
  .object({ kind: z.literal('verify') })
  .strict()
  .meta({ id: 'RefreshVerifyGuidance' })
const retryAfterGuidanceSchema = z
  .object({ kind: z.literal('after'), afterSeconds: retryAfterSecondsSchema })
  .strict()
  .meta({ id: 'RefreshRetryAfterGuidance' })

export const refreshOutcomeSchema = z
  .discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('accepted'), operationId: z.uuid(), retry: pollGuidanceSchema }).strict(),
    z.object({ outcome: z.literal('alreadyRefreshing'), operationId: z.uuid(), retry: pollGuidanceSchema }).strict(),
    z.object({ outcome: z.literal('notNeeded'), retry: noRetryGuidanceSchema }).strict(),
    z.object({ outcome: z.literal('verificationRequired'), retry: verifyGuidanceSchema }).strict(),
    z.object({ outcome: z.literal('rateLimited'), retry: retryAfterGuidanceSchema }).strict(),
    z.object({ outcome: z.literal('temporarilyUnavailable'), retry: retryAfterGuidanceSchema }).strict(),
  ])
  .meta({ id: 'RefreshOutcome', discriminator: { propertyName: 'outcome' } })

const MAX_DISCORD_SNOWFLAKE = 18_446_744_073_709_551_615n

export const discordUserIdSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'must be a Discord snowflake')
  .refine((value) => {
    const snowflake = BigInt(value)
    return snowflake > 0n && snowflake <= MAX_DISCORD_SNOWFLAKE
  }, 'must be a positive unsigned 64-bit Discord snowflake')

export const playerRefreshInputSchema = z
  .object({ id: brawlhallaIdSchema, turnstileToken: z.string().max(2_048).optional() })
  .strict()

export const discordPlayerRefreshInputSchema = z
  .object({
    id: brawlhallaIdSchema,
    discordUserId: discordUserIdSchema,
  })
  .strict()

export const playerRefreshResponseSchema = z
  .object({ player: nullablePlayerReferenceSchema, refresh: refreshOutcomeSchema })
  .strict()
  .meta({ id: 'PlayerRefreshResponse' })

export type RefreshOutcomeContract = z.infer<typeof refreshOutcomeSchema>
export type PlayerRefreshInputContract = z.infer<typeof playerRefreshInputSchema>
export type DiscordPlayerRefreshInputContract = z.infer<typeof discordPlayerRefreshInputSchema>
export type PlayerRefreshResponseContract = z.infer<typeof playerRefreshResponseSchema>

export function parseRefreshOutcomeOutput(value: unknown): RefreshOutcomeContract {
  return refreshOutcomeSchema.parse(value)
}

export function parsePlayerRefreshResponseOutput(value: unknown): PlayerRefreshResponseContract {
  return playerRefreshResponseSchema.parse(value)
}
