import type { SiteEventInputContract } from '@brawltome/contracts'
import type { SearchResults } from '../../server/search'

type SearchReporterOptions = {
  visitId: string
  currentPath: () => string
  countSiteEvent: (event: SiteEventInputContract) => Promise<unknown>
}

export type SearchReporter = ReturnType<typeof createSearchReporter>

// the api refuses anything larger
const largestCount = 100
const longestLatencyMs = 600_000

function cappedCount(count: number): number {
  return Math.min(count, largestCount)
}

function wholeLatencyMs(latencyMs: number): number {
  return Math.min(Math.max(Math.round(latencyMs), 0), longestLatencyMs)
}

function isAliasMatch(player: SearchResults['players'][number] | undefined): boolean {
  return player !== undefined && player.matchedAlias !== null
}

/** Reports searches and picked results for the tab, without ever failing or holding up the search that reports. */
export function createSearchReporter({ visitId, currentPath, countSiteEvent }: SearchReporterOptions) {
  // the site's only search is the bar on the home page
  const tab = () => ({ visitId, path: currentPath(), source: 'bar' as const })

  function send(describe: () => SiteEventInputContract): void {
    try {
      countSiteEvent(describe()).catch(() => undefined)
    } catch {
      // counting is never worth an error on the page
    }
  }

  function performed(query: string, { players, guilds }: SearchResults, latencyMs: number): void {
    send(() => ({
      ...tab(),
      name: 'search.performed',
      query,
      results: cappedCount(players.length + guilds.length),
      aliasResults: cappedCount(players.filter(isAliasMatch).length),
      latencyMs: wholeLatencyMs(latencyMs),
    }))
  }

  function failed(latencyMs: number): void {
    send(() => ({ ...tab(), name: 'search.failed', latencyMs: wholeLatencyMs(latencyMs) }))
  }

  // positions count the shown players first, then the guilds, so one past the players is a guild
  function selected(position: number, shownPlayers: SearchResults['players']): void {
    const viaAlias = isAliasMatch(shownPlayers[position])

    send(() => ({ ...tab(), name: 'search.selected', position: cappedCount(position), viaAlias }))
  }

  return { performed, failed, selected }
}
