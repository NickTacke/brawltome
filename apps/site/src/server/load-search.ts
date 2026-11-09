import {
  type DiscoveryClanHitContract,
  type DiscoveryPlayerHitContract,
  discoverySearchOutputSchema,
} from '@brawltome/contracts'
import { readApi } from './api'
import { failureText } from './optional-read'

export type SearchResults = { players: DiscoveryPlayerHitContract[]; guilds: DiscoveryClanHitContract[] }

// a short limit, the visitor is waiting with the field open
const searchTimeoutMs = 5_000

/** Players and guilds matching a query, in the api's order, which already puts old names last. */
export async function loadSearch(query: string): Promise<SearchResults> {
  const path = `/search?query=${encodeURIComponent(query)}`

  try {
    const { players, clans } = await readApi(path, discoverySearchOutputSchema, 'search', {
      timeoutMs: searchTimeoutMs,
    })

    return { players, guilds: clans }
  } catch (error) {
    // the message reaches the browser, so the detail only goes to the server log
    console.error(failureText(error))

    throw new Error('search failed')
  }
}
