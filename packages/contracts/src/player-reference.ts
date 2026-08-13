import { z } from './zod'

export const brawlhallaIdSchema = z.number().int().positive().max(2_147_483_647)
export const playerNameSchema = z
  .string()
  .refine((name) => [...name].length <= 256, 'Player name must contain at most 256 Unicode characters')
  .refine((name) => /[^\p{Separator}\p{Format}]/u.test(name), 'Player name must contain a visible character')

export const playerReferenceSchema = z
  .object({
    brawlhallaId: brawlhallaIdSchema,
    name: playerNameSchema,
    bestLegendNameKey: z.string().min(1).nullable().optional(),
    legacyRating: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  })
  .strict()

export const nullablePlayerReferenceSchema = playerReferenceSchema.nullable()
export const playerReferenceByIdInputSchema = z.object({ id: brawlhallaIdSchema }).strict()

export type PlayerReferenceContract = z.infer<typeof playerReferenceSchema>

export function parsePlayerReferenceOutput(value: unknown): PlayerReferenceContract | null {
  return nullablePlayerReferenceSchema.parse(value)
}
