import { z } from './zod'

/** One page view the site counts for a visitor. The api adds who it was, as a daily key, from the request itself. */
export const siteVisitInputSchema = z
  .object({
    // random per browser tab, held only in that tab's memory
    visitId: z.string().regex(/^[0-9a-f]{32}$/),
    path: z
      .string()
      .max(200)
      .regex(/^\/[^\s?#]*$/),
    viewportWidth: z.number().int().min(0).max(20_000),
    // set on the first view of a tab only
    referrerDomain: z
      .string()
      .max(253)
      .regex(/^[a-z0-9.-]+$/)
      .optional(),
  })
  .strict()

export const siteVisitResponseSchema = z.object({ recorded: z.boolean() }).strict()

export type SiteVisitInputContract = z.infer<typeof siteVisitInputSchema>
