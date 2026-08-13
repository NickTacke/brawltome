import { describe, expect, test } from 'bun:test'
import { navItems } from '@/components/sidebar/nav-items'
import { parseNavigationContract } from '@/components/sidebar/navigation-contract'
import navigation from '@/components/sidebar/navigation.json'
import { wipFeatures } from '@/lib/wip-features'

const requiredSoonDestinations = ['/stats', '/matches', '/learn', '/tournaments', '/feed']

describe('shell navigation contract', () => {
  test('drives rendered navigation from the serializable parity contract', () => {
    expect(navItems.map(({ href, label, wip }) => ({ href, label, status: wip ? 'soon' : 'live' }))).toEqual(navigation)
  })

  test('rejects unknown or incomplete destination sets before rendering icons', () => {
    expect(() =>
      parseNavigationContract([...navigation.slice(0, -1), { label: 'Other', href: '/other', status: 'soon' }]),
    ).toThrow('unknown href')
    expect(() => parseNavigationContract(navigation.slice(1))).toThrow(
      'navigation contract must contain every shell destination exactly once',
    )
  })

  test('keeps required placeholders visible and non-live', () => {
    for (const href of requiredSoonDestinations) {
      expect(navigation).toContainEqual(expect.objectContaining({ href, status: 'soon' }))
      expect(href.slice(1) in wipFeatures).toBe(true)
    }
  })
})
