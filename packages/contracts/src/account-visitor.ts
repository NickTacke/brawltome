import { accountSchema } from './account'
import { brawlhallaIdSchema } from './player-reference'
import { z } from './zod'

const utcDateTime = z.iso
  .datetime({ offset: false })
  .regex(/Z$/, 'date-time must use the UTC Z suffix')
  .meta({ format: 'date-time' })

// the same ceiling as the tRPC pinned players read, which keeps legacy accounts above the pin limit readable
const maximumPinnedPlayers = 100

const anonymousSessionSchema = z.object({ status: z.literal('anonymous') }).strict()

// any read or write can extend the session, so every answer says when it ends and the site keeps its cookie in step
const signedInSessionSchema = z
  .object({
    status: z.literal('signedIn'),
    account: accountSchema,
    sessionExpiresAt: utcDateTime,
  })
  .strict()

/** The account of the visitor whose session the site forwards, as the API judged that session. */
export const accountSessionSchema = z.discriminatedUnion('status', [anonymousSessionSchema, signedInSessionSchema])

const accountPinnedPlayerSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    order: z.int().min(0).max(2_147_483_647),
    pinnedAt: utcDateTime,
  })
  .strict()

/** The visitor's pinned players in their stored order, without player facts: the site reads those from player. */
export const accountPinnedPlayersSchema = z.array(accountPinnedPlayerSchema).max(maximumPinnedPlayers)

export const accountSignOutSchema = z.object({ status: z.literal('signedOut') }).strict()

export type AccountSessionContract = z.infer<typeof accountSessionSchema>
export type AccountPinnedPlayersContract = z.infer<typeof accountPinnedPlayersSchema>
export type AccountSignOutContract = z.infer<typeof accountSignOutSchema>
