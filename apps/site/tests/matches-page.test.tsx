import { describe, expect, test } from 'bun:test'
import type { MatchDetailContract, MyReplayContract } from '@brawltome/contracts'
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
    legendName: 'IMUGI',
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
}

describe('the matches page', () => {
  test('signed out, it explains matches and offers sign-in', async () => {
    const html = await renderInRouter(
      <MatchesView page={{ kind: 'signedOut', signInUrl: 'https://api.test/auth/discord/login' }} />,
    )

    expect(html).toContain('Matches')
    expect(html).toContain('href="https://api.test/auth/discord/login"')
    expect(html).not.toContain('type="file"')
  })

  test('without a verified player, it sends the visitor to link Steam first', async () => {
    const page: MatchesPage = {
      kind: 'signedIn',
      isVerified: false,
      verifySteamUrl: 'https://api.test/auth/steam/link',
      replays: [],
    }

    const html = await renderInRouter(<MatchesView page={page} />)

    expect(html).toContain('href="/account"')
    expect(html).not.toContain('type="file"')
  })

  test('with a verified player, it takes replay files and lists the uploads with plain reasons', async () => {
    const replays = [
      upload({ status: 'done', matchId: match.id }),
      upload({
        uploadId: '0b0c8f3e-2222-4a6b-9f00-123456789abc',
        status: 'rejected',
        rejection: 'patch-not-supported',
        fileName: '[10.09] Old.replay',
      }),
    ]

    const html = await renderInRouter(
      <MatchesView page={{ kind: 'signedIn', isVerified: true, verifySteamUrl: '', replays }} />,
    )

    expect(html).toContain('type="file"')
    expect(html).toContain('accept=".replay"')
    expect(html).toContain(`href="/match/${match.id}"`)
    expect(html).toContain('patch BrawlTome can')
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
    expect(replayStatusText(upload({ status: 'parsing' }))).toBe('Reading the replay')

    expect(replayStatusText(upload({ status: 'rejected', rejection: 'not-your-match' }))).toBe(
      'You’re not in this match',
    )

    expect(replayStatusText(upload({ status: 'rejected', rejection: 'game-error' }))).toBe('Couldn’t read this replay')
  })
})

describe('the matches page while closed', () => {
  test('shows the coming-soon page', async () => {
    const html = await renderInRouter(<MatchesView page={{ kind: 'comingSoon' }} />)

    expect(html).toContain('Coming soon')
    expect(html).not.toContain('type="file"')
  })
})
