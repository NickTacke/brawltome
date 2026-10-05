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
})
