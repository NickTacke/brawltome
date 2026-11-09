import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { z } from 'zod'
import { excludeUnarmedCookie } from '../components/player/player-format'
import { loadPlayer } from './load-player'
import { recordView } from './record-view'
import { requestRefresh } from './request-refresh'
import { currentVisitor } from './visitor'

const playerIdSchema = z.number().int().positive().max(2_147_483_647)
const refreshRequestSchema = z.object({ id: playerIdSchema, turnstileToken: z.string().max(2_048).optional() })

export const getPlayer = createServerFn({ method: 'GET' })
  .validator(playerIdSchema)
  .handler(({ data: playerId }) => loadPlayer(playerId))

// read on the server, so a remembered choice is already applied in the first html
export const getIsUnarmedExcluded = createServerFn({ method: 'GET' }).handler(
  () => getCookie(excludeUnarmedCookie) !== '0',
)

// a post, so a prefetch or a crawler following links never asks for one
export const refreshPlayer = createServerFn({ method: 'POST' })
  .validator(refreshRequestSchema)
  .handler(({ data }) => requestRefresh('players', data, currentVisitor()))

// a post that only the page on screen sends, so prefetches and the server's own reads are never counted
export const recordPlayerView = createServerFn({ method: 'POST' })
  .validator(playerIdSchema)
  .handler(({ data: playerId }) => recordView(playerId, currentVisitor()))
