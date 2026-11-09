import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { z } from 'zod'
import { excludeUnarmedCookie } from '../components/player/player-format'
import { loadPlayer } from './load-player'

const playerIdSchema = z.number().int().positive().max(2_147_483_647)

export const getPlayer = createServerFn({ method: 'GET' })
  .validator(playerIdSchema)
  .handler(({ data: playerId }) => loadPlayer(playerId))

// read on the server, so a remembered choice is already applied in the first html
export const getIsUnarmedExcluded = createServerFn({ method: 'GET' }).handler(
  () => getCookie(excludeUnarmedCookie) !== '0',
)
