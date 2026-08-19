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

  test('does not query preferences without a session cookie', async () => {
    let queried = false
    const theme = await resolveInitialAccountTheme(undefined, false, async () => {
      queried = true
      return { theme: 'purple' }
    })

    expect(theme).toBeUndefined()
    expect(queried).toBe(false)
  })

  test('keeps neutral when server preference loading fails or is neutral', async () => {
    await expect(
      resolveInitialAccountTheme(undefined, true, async () => Promise.reject(new Error('offline'))),
    ).resolves.toBeUndefined()
    await expect(
      resolveInitialAccountTheme(undefined, true, async () => ({ theme: 'neutral' })),
    ).resolves.toBeUndefined()
  })

  test('prefers the current account preference over a stale purple cookie', async () => {
    let queried = false
    const theme = await resolveInitialAccountTheme('purple', true, async () => {
      queried = true
      return { theme: 'neutral' }
    })

    expect(theme).toBeUndefined()
    expect(queried).toBe(true)
  })

  test('ignores a stale purple cookie without a session', async () => {
    let queried = false
    const theme = await resolveInitialAccountTheme('purple', false, async () => {
      queried = true
      return { theme: 'purple' }
    })

    expect(theme).toBeUndefined()
    expect(queried).toBe(false)
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
