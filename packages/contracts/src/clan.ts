import { brawlhallaIdSchema } from './player-reference'
import { discordUserIdSchema, refreshOutcomeSchema } from './refresh-outcome'
import { z } from './zod'

export const clanIdSchema = z.number().int().positive().max(2_147_483_647)
export const decimalXpSchema = z.string().regex(/^(0|[1-9]\d{0,39})$/)
export const decimalLifetimeXpSchema = z.string().regex(/^(0|[1-9]\d{0,40})$/)
const dateTimeSchema = z.iso.datetime({ offset: false })
const provenanceSchema = z
  .object({
    source: z.enum(['v1-guild-stats', 'v1-guild-members', 'legacy-import']),
    outcome: z.enum(['success', 'ambiguous-failure', 'admission-limited', 'source-rate-limited', 'legacy-unknown']),
    legacyTimestamp: dateTimeSchema.optional(),
  })
  .strict()
const sectionSchema = z
  .object({
    checkedAt: dateTimeSchema.nullable(),
    checkProvenance: provenanceSchema,
    lastSuccessAt: dateTimeSchema.nullable(),
    lastSuccessProvenance: provenanceSchema.nullable(),
  })
  .strict()
const clanMemberSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    name: z.string().min(1).max(256).nullable(),
    rank: z.string().min(1).max(64).nullable(),
    joinDate: dateTimeSchema.nullable(),
    xp: decimalXpSchema,
    guildPoints: decimalXpSchema.nullable(),
  })
  .strict()

const clanProfileShape = {
  clanId: clanIdSchema,
  clanName: z.string().min(1).max(256),
  clanCreateDate: dateTimeSchema,
  clanXp: decimalXpSchema,
  clanLifetimeXp: decimalLifetimeXpSchema,
  notice: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  discordInviteCode: z.string().nullable(),
  guildPoints: decimalXpSchema.nullable(),
  isRecruiting: z.boolean().nullable(),
  profile: sectionSchema,
  roster: sectionSchema.nullable(),
  members: z.array(clanMemberSchema),
}

export const clanProfileSchema = z.object(clanProfileShape).strict().meta({ id: 'ClanProfile' })

export const nullableClanProfileSchema = clanProfileSchema.nullable()
export const clanByIdInputSchema = z.object({ id: clanIdSchema }).strict()
export const clanRefreshInputSchema = z
  .object({
    id: clanIdSchema,
    turnstileToken: z.string().max(2_048).optional(),
  })
  .strict()
export const discordClanRefreshInputSchema = z
  .object({
    id: clanIdSchema,
    discordUserId: discordUserIdSchema,
  })
  .strict()
export const clanRefreshResponseSchema = z
  .object({ clan: z.object(clanProfileShape).strict().nullable(), refresh: refreshOutcomeSchema })
  .strict()
  .meta({ id: 'ClanRefreshResponse' })

export type ClanProfileContract = z.infer<typeof clanProfileSchema>
export type ClanRefreshInputContract = z.infer<typeof clanRefreshInputSchema>
export type DiscordClanRefreshInputContract = z.infer<typeof discordClanRefreshInputSchema>
export type ClanRefreshResponseContract = z.infer<typeof clanRefreshResponseSchema>
