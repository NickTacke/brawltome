import { describe, expect, test } from 'bun:test'
import { MatchesPreview, nextPreviewImageUrl } from '@/app/matches/MatchesPreview'
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
    expect(getPreviewMatch('preview-final')?.winningTeamId).toBe('1')
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

  test('assigns participants to consistent winning teams', () => {
    for (const match of previewMatches) {
      const teamIds = match.participants.map(({ teamId }) => teamId)
      expect(teamIds.every(Boolean)).toBe(true)
      expect(new Set(teamIds).size).toBe(2)
      expect(teamIds).toContain(match.winningTeamId)
    }

    expect(getPreviewMatch('preview-final')?.participants.map(({ teamId }) => teamId)).toEqual(['1', '2'])
    expect(getPreviewMatch('preview-rematch')?.participants.map(({ teamId }) => teamId)).toEqual(['1', '2'])
    expect(getPreviewMatch('preview-team')?.participants.map(({ playerId, teamId }) => [playerId, teamId])).toEqual([
      ['preview-knight', '1'],
      ['preview-orion', '1'],
      ['preview-bodvar', '2'],
      ['preview-cassidy', '2'],
    ])
  })
})

describe('matches preview feed', () => {
  test('labels fixture data and renders exactly three recent matches', () => {
    const html = renderToStaticMarkup(createElement(MatchesPreview, {}))

    expect(html).toContain('Preview data')
    expect(html).toContain('Analyze a real replay')
    expect(html).toContain('aria-label="Preview recent matches"')
    expect(html).toContain('Small Brawlhaven')
    expect(html).toContain('Mammoth Fortress')
    expect(html).toContain('Miami Dome')
    expect(html).toContain('2026-08-17 · 19:40 UTC')
    expect(html.match(/View match/g) ?? []).toHaveLength(3)
    expect(html).toContain('/matches?match=preview-final')
    expect(html).toContain('/matches?analyze=1')
    expect(html).toContain('Winner AxeMender and StarLancer')
    expect(html).toContain('AxeMender &amp; StarLancer vs BlueMammoth &amp; QuickDraw')
    expect(html).toContain('aria-label="Team 1 final score 4, winner"')
    expect(html).toContain('aria-label="Team 2 final score 2"')
  })
})

describe('matches preview detail and player history', () => {
  test('renders fixture detail through the shared truthful report', () => {
    const html = renderToStaticMarkup(createElement(MatchesPreview, { matchId: 'preview-final' }))

    expect(html).toContain('Preview data')
    expect(html).toContain('Event overview')
    expect(html).toContain('Extended combat')
    expect(html).toContain('Movement &amp; positioning')
    expect(html).toContain('Engagements')
    expect(html).toContain('Requires qualified event timeline')
    expect(html).toContain('King Knight')
    expect(html).toContain('https://cms.brawlhalla.com/c/uploads/2021/07/a_Roster_Pose_KingKnightM.png')
    expect(html).toContain('/images/legends/avatars/bodvar.png')
    expect(html).not.toContain('>AX</span>')
    expect(html).not.toContain('>BL</span>')
    expect(html).toContain('/matches?player=preview-knight')
    expect(html).toContain('Unknown scorer')
    expect(html).not.toContain('Environment')
    expect(html).not.toContain('dodges/min')
  })

  test('labels both members of the winning 2v2 team in detail and history', () => {
    const detailHtml = renderToStaticMarkup(createElement(MatchesPreview, { matchId: 'preview-team' }))
    const historyHtml = renderToStaticMarkup(createElement(MatchesPreview, { playerId: 'preview-orion' }))

    expect(detailHtml).toContain('AxeMender &amp; StarLancer')
    expect(detailHtml.match(/aria-label="Winner"/g) ?? []).toHaveLength(2)
    expect(detailHtml).toMatch(/AxeMender<\/span><\/a><svg[^>]*aria-label="Winner"/)
    expect(detailHtml).toMatch(/StarLancer<\/span><\/a><svg[^>]*aria-label="Winner"/)
    expect(detailHtml).not.toMatch(/BlueMammoth<\/span><\/a><svg[^>]*aria-label="Winner"/)
    expect(detailHtml).not.toMatch(/QuickDraw<\/span><\/a><svg[^>]*aria-label="Winner"/)
    expect(historyHtml).toContain('Ranked 2v2 · 2:44 · Win')
  })

  test('derives player history from the same three-match graph', () => {
    const html = renderToStaticMarkup(createElement(MatchesPreview, { playerId: 'preview-knight' }))

    expect(html).toContain('AxeMender')
    expect(html).toContain('King Knight')
    expect(html.match(/View match/g) ?? []).toHaveLength(3)
    expect(html).toContain('/matches?match=preview-final')
  })

  test('transitions a failed primary image to fallback then initials', () => {
    const fallback = nextPreviewImageUrl('primary.png', 'fallback.png')

    expect(fallback).toBe('fallback.png')
    expect(nextPreviewImageUrl(fallback, 'fallback.png')).toBeUndefined()
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
