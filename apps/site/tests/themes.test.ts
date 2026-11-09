import { describe, expect, test } from 'bun:test'
import { themeWarning } from '../src/components/theme/theme-contrast'
import { defaultThemeId, themePresets, themeVariables, tokensFromColours } from '../src/components/theme/theme-palettes'
import { readActiveTheme, readSavedThemes, themeBootScript } from '../src/components/theme/theme-storage'

describe('theme palettes', () => {
  test('offers the chosen presets with slate first', () => {
    expect(themePresets.map(({ id }) => id)).toEqual([
      'slate',
      'midnight',
      'poimandres',
      'amethyst',
      'carbon',
      'vesper',
    ])

    expect(defaultThemeId).toBe('slate')
  })

  test('a made theme keeps its two picks', () => {
    const tokens = tokensFromColours({ page: '#1c1f29', accent: '#54a0f8' })

    expect(tokens.ink).toBe('#1c1f29')
    expect(tokens.primary).toBe('#54a0f8')
  })

  // the sidebar of a made theme sits as close to the page as slate's does
  test('a made theme steps its surfaces from the page like slate', () => {
    expect(tokensFromColours({ page: '#101010', accent: '#ffffff' }).rail).toBe(
      'oklch(from #101010 calc(l - 0.0048) c h)',
    )
  })

  test('sets every colour the site uses', () => {
    expect(Object.keys(themeVariables(themePresets[0].tokens))).toEqual([
      '--color-ink',
      '--color-rail',
      '--color-raised',
      '--color-line',
      '--color-text',
      '--color-strong',
      '--color-soft',
      '--color-primary',
      '--color-primary-ink',
    ])
  })
})

describe('themeWarning', () => {
  test('accepts a dark page with a clear accent', () => {
    expect(themeWarning({ page: '#1c1f29', accent: '#54a0f8' })).toBeNull()
  })

  test('warns about a light page', () => {
    expect(themeWarning({ page: '#f4f4f4', accent: '#2563eb' })).toContain('Light backgrounds')
  })

  test('warns about an accent that disappears into the page', () => {
    expect(themeWarning({ page: '#1c1f29', accent: '#2a2e3a' })).toContain('hard to see')
  })
})

describe('stored themes', () => {
  const savedTheme = { id: 'mine', name: 'Mine', colours: { page: '#101010', accent: '#ffc799' } }

  test('reads saved themes', () => {
    expect(readSavedThemes(JSON.stringify([savedTheme]))).toEqual([savedTheme])
  })

  test.each([null, 'not json', '{"id":1}', '[{"id":"x"}]'])('ignores unreadable saved themes %p', (stored) => {
    expect(readSavedThemes(stored)).toEqual([])
  })

  test('reads the active theme when it still exists', () => {
    const stored = JSON.stringify({ id: 'mine', variables: { '--color-ink': '#101010' } })

    expect(readActiveTheme(stored, [savedTheme])?.id).toBe('mine')
    expect(readActiveTheme(stored, [])).toBeNull()
  })

  test('reads a preset as active', () => {
    expect(readActiveTheme(JSON.stringify({ id: 'vesper', variables: {} }), [])?.id).toBe('vesper')
  })

  // the boot script runs before the page exists, so a bad stored value must never stop the page loading
  test('the boot script applies stored colours and survives bad storage', () => {
    const applied: Record<string, string> = {}

    const documentStub = {
      documentElement: { style: { setProperty: (name: string, value: string) => (applied[name] = value) } },
    }

    const run = (stored: string | null) =>
      new Function('localStorage', 'document', themeBootScript)({ getItem: () => stored }, documentStub)

    run(JSON.stringify({ id: 'vesper', variables: { '--color-ink': '#101010' } }))

    expect(applied['--color-ink']).toBe('#101010')
    expect(() => run('not json')).not.toThrow()
  })
})
