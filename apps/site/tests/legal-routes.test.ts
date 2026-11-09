import { describe, expect, test } from 'bun:test'
import { privacySections } from '../src/components/legal/privacy-sections'
import { discordInviteUrl } from '../src/components/social-links'
import { Route as PrivacyRoute } from '../src/routes/privacy'
import { Route as TermsRoute } from '../src/routes/terms'

type HeadHook = () => { meta: Array<{ title: string }> }

function titleOf(head: unknown): string {
  return (head as HeadHook)().meta[0]?.title ?? ''
}

describe('legal pages', () => {
  test('have their own titles', () => {
    expect(titleOf(PrivacyRoute.options.head)).toBe('Privacy | BrawlTome')
    expect(titleOf(TermsRoute.options.head)).toBe('Terms | BrawlTome')
  })

  // the privacy page promises these, so removing one should be a deliberate change
  test('privacy covers every kind of data the site keeps', () => {
    expect(privacySections.map(({ title }) => title)).toEqual([
      'Player statistics',
      'Signing in',
      'Verifying your Brawlhalla account',
      'Measuring how the site is used',
      'Cookies and browser storage',
      'Abuse protection',
      'What we never do',
      'Your rights',
    ])
  })

  test('the contact link is the community discord', () => {
    expect(discordInviteUrl).toBe('https://discord.gg/ft5CJyjkkS')
  })
})
