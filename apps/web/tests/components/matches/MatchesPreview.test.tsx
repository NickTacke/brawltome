import { describe, expect, test } from 'bun:test'
import {
  getPreviewAppearance,
  getPreviewMatch,
  getPreviewPlayer,
  previewMatches,
  previewMatchesForPlayer,
} from '@/app/matches/matches-preview-fixtures'

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
