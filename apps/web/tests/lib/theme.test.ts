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
    const theme = await resolveInitialAccountTheme(true, async () => ({ theme: 'purple' }))

    expect(theme).toBe('purple')
  })

  test('does not query preferences without a session cookie', async () => {
    let queried = false
    const theme = await resolveInitialAccountTheme(false, async () => {
      queried = true
      return { theme: 'purple' }
    })

    expect(theme).toBeUndefined()
    expect(queried).toBe(false)
  })

  test('keeps the existing blue default when server preference loading fails', async () => {
    await expect(
      resolveInitialAccountTheme(true, async () => Promise.reject(new Error('offline'))),
    ).resolves.toBeUndefined()
    await expect(
      resolveInitialAccountTheme(true, async () => Promise.reject(new Error('offline'))),
    ).resolves.toBeUndefined()
    await expect(resolveInitialAccountTheme(true, async () => ({ theme: 'neutral' }))).resolves.toBeUndefined()
  })

  test('uses the current account preference for an authenticated session', async () => {
    let queried = false
    const theme = await resolveInitialAccountTheme(true, async () => {
      queried = true
      return { theme: 'neutral' }
    })

    expect(theme).toBeUndefined()
    expect(queried).toBe(true)
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
