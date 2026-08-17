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

describe('matches preview detail and player history', () => {
  test('renders truthful match detail with catalog appearances and unsupported data', () => {
    const html = renderToStaticMarkup(createElement(MatchesPreview, { matchId: 'preview-final' }))

    expect(html).toContain('King Knight')
    expect(html).toContain('https://cms.brawlhalla.com/c/uploads/2021/07/a_Roster_Pose_KingKnightM.png')
    expect(html).toContain('/images/legends/avatars/bodvar.png')
    expect(html).toContain('Air 45.0% · Ground 54.0% · Wall 1.0%')
    expect(html).toContain('Unknown scorer')
    expect(html).not.toContain('Environment')
    expect(html).not.toContain('dodges/min')
    expect(html).toContain('Unsupported event')
    expect(html).toContain('/matches?player=preview-knight')
  })

  test('derives player history from the same three-match graph', () => {
    const html = renderToStaticMarkup(createElement(MatchesPreview, { playerId: 'preview-knight' }))

    expect(html).toContain('AxeMender')
    expect(html).toContain('King Knight')
    expect(html.match(/View match/g) ?? []).toHaveLength(3)
    expect(html).toContain('/matches?match=preview-final')
  })

  test('fails safely to the feed for unknown fixture identifiers', () => {
    const matchHtml = renderToStaticMarkup(createElement(MatchesPreview, { matchId: 'missing' }))
    const playerHtml = renderToStaticMarkup(createElement(MatchesPreview, { playerId: 'missing' }))

    expect(matchHtml).toContain('Preview match is unavailable.')
    expect(playerHtml).toContain('Preview player is unavailable.')
    expect(matchHtml.match(/View match/g) ?? []).toHaveLength(3)
    expect(playerHtml.match(/View match/g) ?? []).toHaveLength(3)
  })
})
