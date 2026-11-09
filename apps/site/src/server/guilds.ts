import { clanProfileSchema } from '@brawltome/contracts'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { readApi } from './api'

const guildIdSchema = z.number().int().positive().max(2_147_483_647)

export const getGuild = createServerFn({ method: 'GET' })
  .validator(guildIdSchema)
  .handler(({ data: guildId }) => readApi(`/clans/${guildId}`, clanProfileSchema.nullable(), `load guild ${guildId}`))
