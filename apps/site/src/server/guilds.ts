import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { loadGuild } from './load-guild'
import { requestRefresh } from './request-refresh'
import { currentVisitor } from './visitor'

const guildIdSchema = z.number().int().positive().max(2_147_483_647)
const refreshRequestSchema = z.object({ id: guildIdSchema, turnstileToken: z.string().max(2_048).optional() })

export const getGuild = createServerFn({ method: 'GET' })
  .validator(guildIdSchema)
  .handler(({ data: guildId }) => loadGuild(guildId))

// a post, so a prefetch or a crawler following links never asks for one
export const refreshGuild = createServerFn({ method: 'POST' })
  .validator(refreshRequestSchema)
  .handler(({ data }) => requestRefresh('clans', data, currentVisitor()))
