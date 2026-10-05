import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import PrivacyPage from '../../src/app/privacy/page'

describe('privacy page', () => {
  test('states the analytics guarantees', () => {
    const html = renderToStaticMarkup(<PrivacyPage />)
    for (const phrase of ['No cookies', 'Do Not Track', 'Global Privacy Control', '30 days', 'IP address']) {
      expect(html).toContain(phrase)
    }
  })

  test('is accurate about stored identifiers and sign-in cookies', () => {
    const html = renderToStaticMarkup(<PrivacyPage />)
    expect(html).toContain('random visit ID')
    expect(html).toContain('strictly necessary for signing in')
    expect(html).not.toContain('discarded and never stored')
  })
})
