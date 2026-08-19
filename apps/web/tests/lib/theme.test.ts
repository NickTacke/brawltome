import { afterEach, describe, expect, mock, test } from 'bun:test'
import { applyAccountTheme } from '../../src/lib/theme'

const originalDocument = globalThis.document

afterEach(() => {
  if (originalDocument) {
    globalThis.document = originalDocument
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
})

describe('account theme application', () => {
  test('sets purple and removes the override for neutral', () => {
    const removeAttribute = mock(() => {})
    const dataset: Record<string, string> = {}
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { documentElement: { dataset, removeAttribute } },
    })

    applyAccountTheme('purple')
    expect(dataset.theme).toBe('purple')

    applyAccountTheme('neutral')
    expect(removeAttribute).toHaveBeenCalledWith('data-theme')
  })
})
