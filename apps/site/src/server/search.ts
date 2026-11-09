import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { loadSearch } from './load-search'

const queryLimits = z.string().trim().min(2).max(100)

export const searchPlayersAndGuilds = createServerFn({ method: 'GET' })
  .validator(queryLimits)
  .handler(({ data: query }) => loadSearch(query))

export type { SearchResults } from './load-search'
