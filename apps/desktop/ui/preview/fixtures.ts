/// <reference types="vite/client" />
import type { Card, CardData, OverlayView, TeamData } from '../overlay/overlay-view'

// the json files are the shape the app sends; the rust tests compare against the same files
const fixtureFiles = import.meta.glob<OverlayView>('../../tests/fixtures/overlay-view-*.json', {
  eager: true,
  import: 'default',
})

export function overlayFixture(name: string): OverlayView | null {
  return fixtureFiles[`../../tests/fixtures/overlay-view-${name}.json`] ?? null
}

function requireFixture(name: string): OverlayView {
  const view = overlayFixture(name)

  if (view === null) throw new Error(`load preview fixture ${name}: no overlay-view-${name}.json`)

  return view
}

function soloCard(view: OverlayView): Extract<Card, { kind: 'solo' }> {
  const [card] = view.cards

  if (card?.kind !== 'solo') throw new Error(`load preview fixture for lobby ${view.lobbyId}: expected a solo card`)

  return card
}

function teamCard(view: OverlayView): Extract<Card, { kind: 'team' }> {
  const [card] = view.cards

  if (card?.kind !== 'team') throw new Error(`load preview fixture for lobby ${view.lobbyId}: expected a team card`)

  return card
}

function withSoloData(data: CardData): OverlayView {
  const view = requireFixture('solo-ranked')

  return { ...view, cards: [{ ...soloCard(view), data }] }
}

function withSoloPlayer(name: string, legend: string | null): OverlayView {
  const view = requireFixture('solo-ranked')
  const card = soloCard(view)

  return { ...view, cards: [{ ...card, player: { ...card.player, name, legend } }] }
}

function withTeamData(data: TeamData): OverlayView {
  const view = requireFixture('team')

  return { ...view, cards: [{ ...teamCard(view), data }] }
}

export type StateCell = { title: string; view: OverlayView }

export function stateCells(): StateCell[] {
  const team = requireFixture('team')

  const zeroGames: CardData = {
    state: 'ranked',
    tier: 'Tin 0',
    rating: 782,
    peakRating: 782,
    regionRank: null,
    wins: 0,
    games: 0,
    isRefreshing: false,
  }

  return [
    { title: '1v1', view: requireFixture('solo-ranked') },
    { title: 'Loading', view: requireFixture('solo-loading') },
    { title: 'Stored data, still refreshing', view: requireFixture('solo-refreshing') },
    { title: 'No data for this player', view: requireFixture('solo-no-data') },
    { title: 'No games this season', view: withSoloData(zeroGames) },
    { title: 'Server down, retrying', view: requireFixture('solo-failed') },
    {
      title: 'Offline, retrying',
      view: withSoloData({ state: 'failed', reason: 'offline', retryInSeconds: 2, canRetry: true }),
    },
    {
      title: 'Rate limited, no retry before the match',
      view: withSoloData({ state: 'failed', reason: 'rateLimited', retryInSeconds: null, canRetry: true }),
    },
    {
      title: 'App too old',
      view: withSoloData({ state: 'failed', reason: 'updateRequired', retryInSeconds: null, canRetry: false }),
    },
    {
      title: 'Request rejected',
      view: withSoloData({ state: 'failed', reason: 'rejected', retryInSeconds: null, canRetry: false }),
    },
    { title: 'Long name', view: withSoloPlayer('xX_TheLongestNameInValhallaEver_Xx', 'Lord Vraxx') },
    { title: 'Name with markup', view: withSoloPlayer('<img src=x onerror=alert(1)>', 'Petra') },
    { title: 'Legend without art', view: withSoloPlayer('newcomer', 'Not A Legend') },
    { title: '2v2', view: team },
    { title: '2v2 without team rating', view: requireFixture('team-bare') },
    { title: '2v2 loading', view: withTeamData({ state: 'loading' }) },
    {
      title: '2v2 refreshing',
      view: withTeamData({ state: 'ready', standing: { tier: 'Diamond', rating: 2284 }, isRefreshing: true }),
    },
    {
      title: '2v2 server down',
      view: withTeamData({ state: 'failed', reason: 'unavailable', retryInSeconds: 4, canRetry: true }),
    },
  ]
}

// one 1v1 card per tier, since the banners hang to different lengths
export function tierCells(): StateCell[] {
  const tiers: { tier: string; rating: number; peakRating: number }[] = [
    { tier: 'Tin 3', rating: 812, peakRating: 905 },
    { tier: 'Bronze 4', rating: 1105, peakRating: 1180 },
    { tier: 'Silver 2', rating: 1302, peakRating: 1344 },
    { tier: 'Gold 5', rating: 1618, peakRating: 1702 },
    { tier: 'Platinum 3', rating: 1803, peakRating: 1911 },
    { tier: 'Diamond', rating: 2130, peakRating: 2204 },
    { tier: 'Valhallan', rating: 2504, peakRating: 2611 },
  ]

  return tiers.map(({ tier, rating, peakRating }) => ({
    title: tier,
    view: withSoloData({
      state: 'ranked',
      tier,
      rating,
      peakRating,
      regionRank: 48,
      wins: 734,
      games: 1204,
      isRefreshing: false,
    }),
  }))
}
