import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { PlayerLink } from '../src/components/guild/PlayerLink'
import { sortedAliases } from '../src/components/player/AliasesButton'

afterEach(() => {
  spyOn(String.prototype, 'localeCompare').mockRestore()
})

describe('PlayerLink', () => {
  // the router preloads on hover, and each player page is six internal reads
  test('does not load a player when a roster row is hovered', () => {
    const link = PlayerLink({ playerId: 7, className: '', children: null })

    expect(link.props.preload).toBe(false)
  })
})

describe('sortedAliases', () => {
  test('sorts by name', () => {
    expect(sortedAliases(['Zed', 'Abe'])).toEqual(['Abe', 'Zed'])
  })

  // the browser's own locale can order names differently from the server, which breaks hydration
  test('sorts in one fixed locale', () => {
    const compare = spyOn(String.prototype, 'localeCompare')

    sortedAliases(['Zed', 'Abe'])

    expect(compare.mock.calls.every((call) => call[1] === 'en')).toBe(true)
  })
})
