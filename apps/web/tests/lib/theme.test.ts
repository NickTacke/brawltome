import { afterEach, describe, expect, mock, test } from 'bun:test'
import { applyAccountTheme, resolveInitialAccountTheme } from '../../src/lib/theme'

const originalDocument = globalThis.document

afterEach(() => {
  if (originalDocument) {
    globalThis.document = originalDocument
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
})

describe('account theme application', () => {
  test('loads the saved theme when an authenticated request has no theme cookie', async () => {
    const theme = await resolveInitialAccountTheme(undefined, true, async () => ({ theme: 'purple' }))

    expect(theme).toBe('purple')
  })

  test('sets purple and removes the override for neutral', () => {
    const removeAttribute = mock(() => {})
    const dataset: Record<string, string> = {}
    const fakeDocument = { cookie: '', documentElement: { dataset, removeAttribute } }
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: fakeDocument,
    })

    applyAccountTheme('purple')
    expect(dataset.theme).toBe('purple')
    expect(fakeDocument.cookie).toContain('brawltome-theme=purple')

    applyAccountTheme('neutral')
    expect(removeAttribute).toHaveBeenCalledWith('data-theme')
  })
})
