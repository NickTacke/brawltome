import { describe, expect, test } from 'bun:test'
import type { ClanProfileContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { GuildHeader } from '../src/components/guild/GuildHeader'
import { PlayerPage } from '../src/components/player/PlayerPage'
import type { RefreshStatus } from '../src/components/refresh/refresh-run'
import type { PlayerPage as PlayerPageData } from '../src/server/load-player'

const loadedAt = '2026-11-09T12:00:00.000Z'
const updatedAt = '2026-11-09T09:00:00.000Z'

const page: PlayerPageData = {
  player: {
    brawlhallaId: 7,
    name: 'Seven',
    aliases: [],
    clan: null,
    bestLegendNameKey: null,
    currentSeason: null,
    career: null,
  },
  seasonStarts: [],
  loadedAt,
}

const section = { checkedAt: updatedAt, checkProvenance: { source: 'v1-guild-stats', outcome: 'success' } }

const clan = {
  clanId: 77,
  clanName: 'Valhalla',
  clanCreateDate: '2020-01-01T00:00:00.000Z',
  notice: null,
  discordInviteCode: null,
  isRecruiting: false,
  profile: { ...section, lastSuccessAt: updatedAt },
  members: [],
} as unknown as ClanProfileContract

function renderPlayer(status: RefreshStatus): string {
  const refresh = { status, onRetry: () => {} }

  return renderToStaticMarkup(<PlayerPage {...page} isUnarmedExcluded={false} refresh={refresh} />)
}

function renderGuild(status: RefreshStatus): string {
  return renderToStaticMarkup(<GuildHeader clan={clan} refresh={{ status, onRetry: () => {} }} />)
}

describe('updated time', () => {
  test('a running refresh takes the place of the updated time', () => {
    const html = renderGuild('updating')

    expect(html).toContain('Updating…')
    expect(html).not.toContain('Updated')
  })

  test('the updated time comes back once the refresh is done', () => {
    const html = renderGuild('idle')

    expect(html).toContain('Updated')
    expect(html).not.toContain('Updating…')
  })

  test('a failed refresh keeps the updated time beside the retry', () => {
    const html = renderGuild('failed')

    expect(html).toContain('Updated')
    expect(html).toContain('Try again</button>')
  })
})

describe('refresh status line', () => {
  test('a failed refresh still shows the page, with one quiet line and a retry', () => {
    const html = renderPlayer('failed')

    expect(html).toContain('Seven')
    expect(html).toContain('Couldn&#x27;t update')
    expect(html).toContain('Try again</button>')
  })

  test('a running refresh says so', () => {
    expect(renderPlayer('updating')).toContain('Updating…')
  })

  test('an idle page shows no refresh state', () => {
    const html = renderPlayer('idle')

    expect(html).not.toContain('Updating')
    expect(html).not.toContain('update')
  })
})
