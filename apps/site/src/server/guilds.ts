import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { loadGuild } from './load-guild'

const guildIdSchema = z.number().int().positive().max(2_147_483_647)

export const getGuild = createServerFn({ method: 'GET' })
  .validator(guildIdSchema)
  .handler(({ data: guildId }) => loadGuild(guildId))
