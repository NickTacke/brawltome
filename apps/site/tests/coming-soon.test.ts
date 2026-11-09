import { describe, expect, test } from 'bun:test'
import { comingSoonFeatures } from '../src/components/coming-soon/features'
import { Route as LearnRoute } from '../src/routes/learn'
import { Route as MatchesRoute } from '../src/routes/matches'
import { Route as StatisticsRoute } from '../src/routes/stats'
import { Route as TournamentsRoute } from '../src/routes/tournaments'

type HeadHook = () => { meta: Array<{ title: string }> }

function titleOf(head: unknown): string {
  return (head as HeadHook)().meta[0]?.title ?? ''
}

describe('coming soon pages', () => {
  test('cover every rail item marked soon', () => {
    expect(Object.keys(comingSoonFeatures)).toEqual(['stats', 'matches', 'learn', 'tournaments'])
  })

  test.each([
    [StatisticsRoute, 'Statistics | BrawlTome'],
    [MatchesRoute, 'Matches | BrawlTome'],
    [LearnRoute, 'Learn | BrawlTome'],
    [TournamentsRoute, 'Tournaments | BrawlTome'],
  ])('%#: titles the page', (route, title) => {
    expect(titleOf(route.options.head)).toBe(title)
  })

  // the copy is carried over from the old site unchanged
  test('keeps the old site wording', () => {
    expect(comingSoonFeatures.stats.tagline).toBe('Win rates, pick rates, tier list. Real ranked data')

    expect(comingSoonFeatures.tournaments.description).toBe(
      'Live brackets, results, and streams from Challengermode-hosted events. Players linked to their BrawlTome profiles. Approved organizers can host tournaments directly on BrawlTome',
    )
  })
})
