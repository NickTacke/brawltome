import { describe, expect, test } from 'bun:test'
import { navItems } from '@/components/sidebar/nav-items'
import { wipFeatures } from '@/lib/wip-features'

const requiredSoonDestinations = ['/stats', '/matches', '/learn', '/tournaments', '/feed']

describe('shell navigation', () => {
  test('keeps live and placeholder destinations honest', () => {
    expect(navItems.find(({ href }) => href === '/')?.wip).toBeFalsy()
    for (const href of requiredSoonDestinations) {
      expect(navItems).toContainEqual(expect.objectContaining({ href, wip: true }))
      expect(href.slice(1) in wipFeatures).toBe(true)
    }
  })
})
