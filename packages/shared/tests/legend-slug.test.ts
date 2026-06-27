import { describe, expect, it } from 'bun:test'
import { legendSlug } from '@brawltome/shared'

// v1's `legend_name` is an uppercase display string; the avatar/icon assets are keyed by the
// lowercase v0 `legend_name_key` slug. These cases mirror the real v0 /legend/all mapping.
describe('legendSlug', () => {
  it('lowercases, strips diacritics, and keeps spaces', () => {
    expect(legendSlug(3, 'BÖDVAR')).toBe('bodvar')
    expect(legendSlug(4, 'CASSIDY')).toBe('cassidy')
    expect(legendSlug(6, 'LORD VRAXX')).toBe('lord vraxx')
    expect(legendSlug(8, 'QUEEN NAI')).toBe('queen nai')
    expect(legendSlug(29, 'WU SHANG')).toBe('wu shang')
    expect(legendSlug(66, 'KING ZUVA')).toBe('king zuva')
  })

  it('applies an override where the asset slug diverges from the display name', () => {
    // asset is redraptor.png (no space), unlike every other multi-word legend
    expect(legendSlug(17, 'RED RAPTOR')).toBe('redraptor')
  })
})
