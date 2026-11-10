import { describe, expect, test } from 'bun:test'
import type { SiteEventInputContract } from '@brawltome/contracts'
import { createSearchReporter } from '../src/components/search/search-reporter'
import type { SearchResults } from '../src/server/search'

const tab = { visitId: 'f'.repeat(32), path: '/', source: 'bar' } as const

function player(brawlhallaId: number, matchedAlias: string | null = null): SearchResults['players'][number] {
  const name = `Player${brawlhallaId}`

  return { brawlhallaId, name, region: 'EU', rating: 2000, viewCount: 0, bestLegendNameKey: null, matchedAlias }
}

const guild = { clanId: 9, clanName: 'Valhalla', clanXp: '1000', memberCount: 12 }
const players = [player(1), player(2, 'OldName')]

function reporterRecording(countSiteEvent: (event: SiteEventInputContract) => Promise<unknown>) {
  return createSearchReporter({ visitId: tab.visitId, currentPath: () => tab.path, countSiteEvent })
}

function recordingReporter() {
  const sent: SiteEventInputContract[] = []
  const reporter = reporterRecording(async (event) => sent.push(event))

  return { reporter, sent }
}

describe('search reporter', () => {
  test('a search says what was typed, how much it found and how long it took', () => {
    const { reporter, sent } = recordingReporter()

    reporter.performed('old', { players, guilds: [guild] }, 180.4)

    const found = { query: 'old', results: 3, aliasResults: 1, latencyMs: 180 }

    expect(sent).toEqual([{ ...tab, name: 'search.performed', ...found }])
  })

  test('counts and latency stay inside what the api accepts', () => {
    const { reporter, sent } = recordingReporter()
    const manyPlayers = Array.from({ length: 150 }, (_, index) => player(index, 'OldName'))

    reporter.performed('old', { players: manyPlayers, guilds: [] }, 900_000)
    reporter.failed(-1)

    expect(sent[0]).toMatchObject({ results: 100, aliasResults: 100, latencyMs: 600_000 })
    expect(sent[1]).toEqual({ ...tab, name: 'search.failed', latencyMs: 0 })
  })

  test('a picked result says its place in the list, players first, and whether an old name found it', () => {
    const { reporter, sent } = recordingReporter()

    reporter.selected(0, players)
    reporter.selected(1, players)
    // past the shown players, so a guild
    reporter.selected(2, players)

    expect(sent).toEqual([
      { ...tab, name: 'search.selected', position: 0, viaAlias: false },
      { ...tab, name: 'search.selected', position: 1, viaAlias: true },
      { ...tab, name: 'search.selected', position: 2, viaAlias: false },
    ])
  })

  test('a failed report never reaches the page', async () => {
    const rejects = reporterRecording(() => Promise.reject(new Error('network down')))

    const throws = reporterRecording(() => {
      throw new Error('server function missing')
    })

    for (const reporter of [rejects, throws]) {
      expect(() => reporter.performed('old', { players, guilds: [] }, 180)).not.toThrow()
      expect(() => reporter.failed(180)).not.toThrow()
      expect(() => reporter.selected(0, players)).not.toThrow()
    }

    // a rejection left unhandled would surface after the calls return
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
