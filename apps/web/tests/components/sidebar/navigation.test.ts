import { describe, expect, test } from 'bun:test'
import { navItems } from '@/components/sidebar/nav-items'
import { wipFeatures } from '@/lib/wip-features'

const requiredSoonDestinations = ['/stats', '/matches', '/learn', '/tournaments']

describe('shell navigation', () => {
  test('keeps live and placeholder destinations honest', () => {
    expect(navItems.find(({ href }) => href === '/')?.wip).toBeFalsy()
    expect(navItems).toContainEqual(expect.objectContaining({ href: '/queue', label: 'Queue' }))
    expect(navItems.find(({ href }) => href === '/queue')?.wip).toBeFalsy()
    expect(navItems.map(({ href }) => href)).toEqual(['/', '/stats', '/matches', '/queue', '/learn', '/tournaments'])
    expect(navItems.some(({ label }) => label === 'Feed')).toBe(false)
    expect('feed' in wipFeatures).toBe(false)
    for (const href of requiredSoonDestinations) {
      expect(navItems).toContainEqual(expect.objectContaining({ href, wip: true }))
      expect(href.slice(1) in wipFeatures).toBe(true)
    }
  })
})
