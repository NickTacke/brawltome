import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LookupCard } from '../../../src/components/player/PlayerProfile/LookupCard'
import { RefreshStatusBanner } from '../../../src/components/player/PlayerProfile/RefreshStatusBanner'
import type { PlayerRefreshNotice } from '../../../src/lib/player-refresh-status'

const busy: PlayerRefreshNotice = {
  tone: 'warning',
  title: "Brawlhalla's servers are busy",
  detail: 'Retrying in 12s.',
  countdownSeconds: 12,
  action: { label: 'Try now' },
}

describe('LookupCard', () => {
  test('shows a loading state with the player ID while looking up', () => {
    const html = renderToStaticMarkup(<LookupCard id="1234" notice={null} onAction={() => {}} turnstile={null} />)

    expect(html).toContain('1234')
    expect(html).toContain('Looking up player...')
    expect(html).not.toContain('<button')
  })

  test('explains the problem with a retry action instead of a bare message', () => {
    const html = renderToStaticMarkup(<LookupCard id="1234" notice={busy} onAction={() => {}} turnstile={null} />)

    expect(html).toContain('1234')
    expect(html).toContain('Brawlhalla&#x27;s servers are busy')
    expect(html).toContain('Retrying in 12s.')
    expect(html).toContain('Try now')
    expect(html).not.toContain('Looking up player...')
  })
})

describe('RefreshStatusBanner', () => {
  test('renders a warning notice with an action', () => {
    const html = renderToStaticMarkup(<RefreshStatusBanner notice={busy} onAction={() => {}} />)

    expect(html).toContain('border-amber-500/30')
    expect(html).toContain('Brawlhalla&#x27;s servers are busy')
    expect(html).toContain('Try now')
  })

  test('renders informational notices in muted styling', () => {
    const html = renderToStaticMarkup(
      <RefreshStatusBanner
        notice={{
          tone: 'info',
          title: 'Still updating',
          detail: 'Showing data from 3h ago.',
          countdownSeconds: null,
          action: { label: 'Refresh' },
        }}
        onAction={() => {}}
      />,
    )

    expect(html).not.toContain('amber')
    expect(html).toContain('Still updating')
    expect(html).toContain('Refresh')
  })
})
