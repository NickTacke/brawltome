import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { readApi } from './api'

const guildIdSchema = z.number().int().positive().max(2_147_483_647)
const guildSchema = z.object({ name: z.string().nullable() }).nullable()

export const getGuild = createServerFn({ method: 'GET' })
  .validator(guildIdSchema)
  .handler(({ data: guildId }) => readApi(`/clans/${guildId}`, guildSchema, `load guild ${guildId}`))
