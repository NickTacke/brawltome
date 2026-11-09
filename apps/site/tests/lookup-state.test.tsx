import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LookupStatus } from '../src/components/lookup/lookup-run'
import { PlayerLookup } from '../src/components/lookup/PlayerLookup'

function renderLookup(status: LookupStatus): string {
  return renderToStaticMarkup(<PlayerLookup playerId={1234} status={status} onRetry={() => {}} />)
}

describe('player lookup', () => {
  test('a running lookup is a heading and one quiet line, with no spinner', () => {
    const html = renderLookup('looking')

    expect(html).toContain('Looking up player 1234…')
    expect(html).not.toContain('animate-spin')
    expect(html).not.toContain('<button')
  })

  test('a found player says the profile is on its way', () => {
    expect(renderLookup('found')).toContain('Loading the profile…')
  })

  test('a player that never turns up reads as not found, with a retry', () => {
    const html = renderLookup('missing')

    expect(html).toContain('Player not found')
    expect(html).toContain('Try again</button>')
  })

  test.each([
    ['refused', 'Too many lookups'],
    ['unverified', 'verify your browser'],
    ['failed', 'Something went wrong on our side'],
  ] as const)('a %p lookup explains itself and offers a retry', (status, explanation) => {
    const html = renderLookup(status)

    expect(html).toContain('Couldn&#x27;t look up player 1234')
    expect(html).toContain(explanation)
    expect(html).toContain('Try again</button>')
  })

  test('the status line is announced as it changes', () => {
    expect(renderLookup('looking')).toContain('aria-live="polite"')
  })
})
