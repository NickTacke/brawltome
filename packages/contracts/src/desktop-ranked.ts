import { nullablePlayerRankedProfileSchema } from './player-ranked'
import { brawlhallaIdSchema, nullablePlayerReferenceSchema } from './player-reference'
import { refreshOutcomeSchema } from './refresh-outcome'
import { z } from './zod'

export const desktopRankedLookupInputSchema = z.object({ brawlhallaId: brawlhallaIdSchema }).strict()

export const desktopRankedLookupSchema = z
  .object({
    player: nullablePlayerReferenceSchema,
    ranked: nullablePlayerRankedProfileSchema,
    refresh: refreshOutcomeSchema,
  })
  .strict()
  .meta({ id: 'DesktopRankedLookup' })

export type DesktopRankedLookupContract = z.infer<typeof desktopRankedLookupSchema>

export function parseDesktopRankedLookupOutput(value: unknown): DesktopRankedLookupContract {
  return desktopRankedLookupSchema.parse(value)
}
