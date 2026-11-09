import { brawlhallaIdSchema } from './player-reference'
import { refreshOutcomeSchema } from './refresh-outcome'
import { z } from './zod'

// a signed token the api issues once a visitor passes the challenge, about 100 characters long
const refreshTrustSchema = z.string().min(1).max(256)

/** A refresh the site asks for on behalf of one visitor. Players and guilds share the id range. */
export const visitorRefreshInputSchema = z
  .object({
    id: brawlhallaIdSchema,
    turnstileToken: z.string().max(2_048).optional(),
    refreshTrust: refreshTrustSchema.optional(),
  })
  .strict()

/** The outcome, plus a new trust token when the visitor just passed the challenge, for the site to keep in a cookie. */
export const visitorRefreshResponseSchema = z
  .object({ refresh: refreshOutcomeSchema, refreshTrust: refreshTrustSchema.nullable() })
  .strict()

export type VisitorRefreshInputContract = z.infer<typeof visitorRefreshInputSchema>
export type VisitorRefreshResponseContract = z.infer<typeof visitorRefreshResponseSchema>
