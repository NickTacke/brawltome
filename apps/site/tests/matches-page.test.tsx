import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract, MatchSummaryContract, MyReplayContract } from '@brawltome/contracts'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MatchesView } from '../src/components/matches/MatchesView'
import { MatchView } from '../src/components/matches/MatchView'
import { formatDuration, type MatchesPage, replayStatusText } from '../src/components/matches/matches-model'

async function renderInRouter(element: ReactNode): Promise<string> {
  const rootRoute = createRootRoute({ component: () => element })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/matches'] }) })

  await router.load()

  return renderToStaticMarkup(<RouterProvider router={router} />)
}

function upload(overrides: Partial<MyReplayContract>): MyReplayContract {
  return {
    uploadId: '0b0c8f3e-1111-4a6b-9f00-123456789abc',
    fileName: '[11.00] BigCrystalTemple.replay',
    status: 'waiting',
    rejection: null,
    matchId: null,
    createdAt: '2026-11-13T20:00:00.000Z',
    ...overrides,
  }
}

const match: MatchDetailContract = {
  id: '6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f',
  patch: '11.00',
  mapName: 'Big Crystal Temple',
  modeName: 'Stock',
  isRanked: true,
  isCustom: false,
  durationMs: 187000,
  parsedAt: '2026-11-13T20:00:00.000Z',
  mapPictureUrl: null,
  queue: 'ranked',
  hasTeams: false,
  hasTeamDamage: false,
  stocks: 3,
  isReliable: true,
  failedChecks: [],
  players: [1, 2].map((slot) => ({
    slot,
    brawlhallaId: 1000 + slot,
    name: slot === 1 ? 'Alpha' : 'Bravo',
    team: 0,
    legendId: 65,
    legendName: 'Imugi',
    legendKey: 'imugi',
    isWinner: slot === 1,
    damageDealt: 322.22,
    damageTaken: 547.65,
    kos: 1,
    deaths: 4,
    suicides: 0,
    teamKos: 0,
    clashes: 1,
    dodges: 8,
    airDodges: 7,
    jumps: 105,
    airJumps: 70,
    dashes: 19,
    dashJumps: 1,
    timeInAirMs: 122256,
    timeOnGroundMs: 29520,
    timeOnWallMs: 1600,
    score: 38,
    weapons: {},
  })),
  replay: { available: true, patch: '11.00', fileName: '[11.00] BigCrystalTemple.replay' },
  insights: null,
  art: { state: 'none', manifestUrl: null, baseUrl: null },
  playbackPath: null,
}

function summary(overrides: Partial<MatchSummaryContract> = {}): MatchSummaryContract {
  const player = (slot: number, brawlhallaId: number, name: string, deaths: number, isWinner: boolean) => ({
    slot,
    brawlhallaId,
    name,
    team: 0,
    legendId: 3,
    legendName: 'Ember',
    legendKey: 'ember',
    kos: 3 - deaths,
    deaths,
    damageDealt: 250,
    score: null,
    isWinner,
  })

  return {
    id: match.id,
    patch: '11.01',
    mapName: 'Mishima Dojo',
    modeName: 'Stock',
    isRanked: true,
    isCustom: false,
    queue: 'ranked',
    hasTeams: false,
    stocks: 3,
    durationMs: 90_000,
    parsedAt: '2026-11-18T21:48:00.000Z',
    mapPictureUrl: 'https://art.brawltome.app/sheets/0a595e48e9f677f4.webp',
    players: [player(1, 1001, 'Alpha', 1, true), player(2, 1002, 'Bravo', 3, false)],
    ...overrides,
  }
}

const loadedAt = '2026-11-18T22:00:00.000Z'
const emptyRecord = { games: 0, wins: 0, draws: 0, lastParsedAt: null, legends: [] }

function signedInPage(overrides: Partial<Extract<MatchesPage, { kind: 'signedIn' }>> = {}): MatchesPage {
  return {
    kind: 'signedIn',
    canUpload: true,
    verifySteamUrl: '',
    replays: [],
    mine: {
      player: { brawlhallaId: 1002, name: 'Bravo' },
      record: { games: 1, wins: 0, draws: 0, lastParsedAt: '2026-11-18T21:48:00.000Z', legends: [] },
      matches: [summary()],
      nextCursor: null,
    },
    recent: { matches: [summary()], nextCursor: 'next' },
    loadedAt,
    ...overrides,
  }
}

describe('the matches page', () => {
  test('signed out, it lists everyone’s latest matches and offers sign-in', async () => {
    const recent = { matches: [summary()], nextCursor: null }
    const page: MatchesPage = { kind: 'signedOut', signInUrl: 'https://api.test/auth/discord/login', recent, loadedAt }

    const html = await renderInRouter(<MatchesView page={page} />)

    expect(html).toContain('href="https://api.test/auth/discord/login"')
    expect(html).toContain(`href="/match/${match.id}"`)
    expect(html).toContain('Mishima Dojo · 12m')
    expect(html).not.toContain('type="file"')
  })

  test('without a verified player, it sends the visitor to link Steam first', async () => {
    const html = await renderInRouter(<MatchesView page={signedInPage({ canUpload: false })} />)

    expect(html).toContain('href="/account"')
    expect(html).not.toContain('type="file"')
  })

  test('with a verified player, it lists their matches from their side, with the result', async () => {
    const html = await renderInRouter(<MatchesView page={signedInPage()} />)

    expect(html).toContain('type="file"')
    expect(html).toContain('href="/player/1002"')
    expect(html).toContain('Ranked 1v1')
    expect(html).toContain('Lost')
    expect(html).toContain('Show more')
  })

  test('a draw in the record is neither a win nor a loss', async () => {
    const ember = { legendId: 3, legendName: 'Ember', legendKey: 'ember', games: 3, wins: 1, draws: 1 }
    const record = { games: 3, wins: 1, draws: 1, lastParsedAt: '2026-11-18T21:48:00.000Z', legends: [ember] }
    const mine = { player: { brawlhallaId: 1002, name: 'Bravo' }, record, matches: [summary()], nextCursor: null }

    const html = await renderInRouter(<MatchesView page={signedInPage({ mine })} />)

    expect(html).toContain('3 matches')
    expect(html).toContain('50.0%')
    expect(html).toContain('1W 1L 1D')
  })

  test('with no matches yet, it shows where to drop replays and where the game keeps them', async () => {
    const mine = { player: { brawlhallaId: 1002, name: 'Bravo' }, record: emptyRecord, matches: [], nextCursor: null }

    const html = await renderInRouter(<MatchesView page={signedInPage({ mine })} />)

    expect(html).toContain('Drop .replay files')
    expect(html).toContain('Documents/BrawlhallaReplays')
    expect(html).toContain('No matches yet')
  })

  test('uploads still being read, and ones that failed today, are listed with plain reasons', async () => {
    const replays = [
      upload({ status: 'parsing', createdAt: '2026-11-18T21:59:00.000Z' }),
      upload({
        uploadId: '0b0c8f3e-2222-4a6b-9f00-123456789abc',
        status: 'rejected',
        rejection: 'patch-not-supported',
        fileName: '[10.09] Old.replay',
        createdAt: '2026-11-18T20:00:00.000Z',
      }),
      upload({
        uploadId: '0b0c8f3e-3333-4a6b-9f00-123456789abc',
        status: 'rejected',
        rejection: 'not-a-replay',
        fileName: 'last-week.replay',
        createdAt: '2026-11-10T20:00:00.000Z',
      }),
    ]

    const html = await renderInRouter(<MatchesView page={signedInPage({ replays })} />)

    expect(html).toContain('Reading…')
    expect(html).toContain('Patch too old')
    expect(html).not.toContain('last-week.replay')
  })
})

describe('a match page', () => {
  test('shows the map, the players with their stats, and the save button with its patch', async () => {
    const html = await renderInRouter(<MatchView match={match} />)

    expect(html).toContain('Big Crystal Temple')
    expect(html).toContain('href="/player/1001"')
    expect(html).toContain('322')
    expect(html).toContain(`href="/match/${match.id}/replay"`)
    expect(html).toContain('Plays on patch 11.00')
    expect(html).not.toContain('may be off')
  })

  test('warns when the numbers could not be checked, and hides the save button once the file is gone', async () => {
    const html = await renderInRouter(
      <MatchView
        match={{ ...match, isReliable: false, failedChecks: ['damage'], replay: { ...match.replay, available: false } }}
      />,
    )

    expect(html).toContain('may be off')
    expect(html).not.toContain('/replay"')
  })
})

describe('match page wording', () => {
  test('durations read as minutes and seconds', () => {
    expect(formatDuration(187000)).toBe('3:07')
    expect(formatDuration(59000)).toBe('0:59')
  })

  test('each upload state reads plainly', () => {
    expect(replayStatusText(upload({ status: 'waiting' }))).toBe('Waiting')
    expect(replayStatusText(upload({ status: 'parsing' }))).toBe('Reading…')

    expect(replayStatusText(upload({ status: 'rejected', rejection: 'not-your-match' }))).toBe('Not your match')

    expect(replayStatusText(upload({ status: 'rejected', rejection: 'game-error' }))).toBe('Couldn’t read it')
  })
})

describe('the matches page while closed', () => {
  test('shows the coming-soon page', async () => {
    const html = await renderInRouter(<MatchesView page={{ kind: 'comingSoon' }} />)

    expect(html).toContain('Coming soon')
    expect(html).not.toContain('type="file"')
  })
})
