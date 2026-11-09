import { z } from './zod'

const seasonStartSchema = z.object({ season: z.number().int().positive(), startsAt: z.iso.datetime() }).strict()

export const seasonStartsSchema = z.array(seasonStartSchema)

export type SeasonStartContract = z.infer<typeof seasonStartSchema>
