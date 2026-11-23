import { describe, expect, test } from 'bun:test'
import { highlightTournamentIds, pickHighlights } from '../../domain/highlights'
import { buildLegendLookup } from '../../domain/legend-keys'
import { shapeEsportsProfile } from '../../domain/profile'
import { placement, stored } from './builders'

const legendLookup = buildLegendLookup()

function profileOf(placements: ReturnType<typeof placement>[]) {
  const profile = shapeEsportsProfile(stored({ placements }), legendLookup)

  if (!profile) throw new Error('shape a profile for the highlight tests: none was made')

  return profile
}

function onDay(day: number): Date {
  return new Date(Date.UTC(2026, 0, day))
}

describe('highlights', () => {
  test('takes the four best top-8 finishes, the newer first on a tie', () => {
    const profile = profileOf([
      placement({ tournamentId: 'second-old', tournamentName: 'Old Cup', placement: 2, startTime: onDay(1) }),
      placement({ tournamentId: 'second-new', tournamentName: 'New Cup', placement: 2, startTime: onDay(9) }),
      placement({ tournamentId: 'first', tournamentName: 'Main Cup', placement: 1, startTime: onDay(2) }),
      placement({ tournamentId: 'eighth', tournamentName: 'Late Cup', placement: 8, startTime: onDay(3) }),
      placement({ tournamentId: 'ninth', tournamentName: 'Ninth Cup', placement: 9, startTime: onDay(4) }),
      placement({ tournamentId: 'fifth', tournamentName: 'Fifth Cup', placement: 5, startTime: onDay(5) }),
    ])

    const tournamentIds = pickHighlights(profile.results).map((result) => result.tournamentId)

    expect(tournamentIds).toEqual(['first', 'second-new', 'second-old', 'fifth'])
  })

  test('a player with no top 8 has no highlights', () => {
    const profile = profileOf([placement({ placement: 9 })])

    expect(highlightTournamentIds(profile)).toEqual([])
  })

  test('lists the highlights of every filter once', () => {
    const solo = [1, 2, 3, 4, 5].map((place) =>
      placement({ mode: 1, tournamentId: `solo-${place}`, tournamentName: `Solo ${place}`, placement: place }),
    )

    const duo = [1, 2].map((place) =>
      placement({ mode: 2, tournamentId: `duo-${place}`, tournamentName: `Duo ${place}`, placement: place }),
    )

    const tournamentIds = highlightTournamentIds(profileOf([...solo, ...duo]))

    expect(tournamentIds.toSorted()).toEqual(['duo-1', 'duo-2', 'solo-1', 'solo-2', 'solo-3', 'solo-4'])
  })
})
