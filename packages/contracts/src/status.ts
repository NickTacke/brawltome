import { z } from './zod'

export const apiStatusSchema = z
  .object({
    status: z.literal('ready').meta({ description: 'The API is up and accepting requests' }),
  })
  .strict()
