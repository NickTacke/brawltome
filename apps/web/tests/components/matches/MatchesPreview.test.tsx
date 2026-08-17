import { describe, expect, test } from 'bun:test'
import { MatchesPreview } from '@/app/matches/MatchesPreview'
import {
  getPreviewAppearance,
  getPreviewMatch,
  getPreviewPlayer,
  previewMatches,
  previewMatchesForPlayer,
} from '@/app/matches/matches-preview-fixtures'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

describe('matches preview fixtures', () => {
  test('form one consistent three-match graph with validated appearances', () => {
    expect(previewMatches).toHaveLength(3)
    expect(getPreviewMatch('preview-final')?.winnerPlayerId).toBe('preview-knight')
    expect(previewMatchesForPlayer('preview-knight')).toHaveLength(3)

    const knight = getPreviewPlayer('preview-knight')
    const bodvar = getPreviewPlayer('preview-bodvar')
    expect(knight && getPreviewAppearance(knight)).toMatchObject({
      kind: 'crossover',
      name: 'King Knight',
      fallbackImageUrl: '/images/legends/avatars/sir roland.png',
      diagnostic: null,
    })
    expect(bodvar && getPreviewAppearance(bodvar)).toMatchObject({
      kind: 'legend',
      name: 'BÖDVAR',
      imageUrl: '/images/legends/avatars/bodvar.png',
      diagnostic: { code: 'unknown_skin' },
    })
  })
})

describe('matches preview feed', () => {
  test('labels fixture data and renders exactly three recent matches', () => {
    const html = renderToStaticMarkup(createElement(MatchesPreview, {}))

    expect(html).toContain('Preview data')
    expect(html).toContain('Small Brawlhaven')
    expect(html).toContain('Mammoth Fortress')
    expect(html).toContain('Miami Dome')
    expect(html).toContain('2026-08-17 · 19:40 UTC')
    expect(html.match(/View match/g) ?? []).toHaveLength(3)
    expect(html).toContain('/matches?match=preview-final')
    expect(html).toContain('/matches?analyze=1')
  })
})
