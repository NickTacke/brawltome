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

const now = new Date('2026-11-23T12:00:00Z')
const dayMs = 24 * 60 * 60 * 1000

function daysBefore(days: number): Date {
  return new Date(now.getTime() - days * dayMs)
}

function pickedIds(placements: ReturnType<typeof placement>[]): string[] {
  return pickHighlights(profileOf(placements).results, now).map((result) => result.tournamentId)
}

describe('highlights', () => {
  test('among community finishes takes the four best top-8 placements, the newer first on a tie', () => {
    const profile = profileOf([
      placement({ tournamentId: 'second-old', tournamentName: 'Old Cup', placement: 2, startTime: onDay(1) }),
      placement({ tournamentId: 'second-new', tournamentName: 'New Cup', placement: 2, startTime: onDay(9) }),
      placement({ tournamentId: 'first', tournamentName: 'Main Cup', placement: 1, startTime: onDay(2) }),
      placement({ tournamentId: 'eighth', tournamentName: 'Late Cup', placement: 8, startTime: onDay(3) }),
      placement({ tournamentId: 'ninth', tournamentName: 'Ninth Cup', placement: 9, startTime: onDay(4) }),
      placement({ tournamentId: 'fifth', tournamentName: 'Fifth Cup', placement: 5, startTime: onDay(5) }),
    ])

    const tournamentIds = pickHighlights(profile.results, now).map((result) => result.tournamentId)

    expect(tournamentIds).toEqual(['first', 'second-new', 'second-old', 'fifth'])
  })

  test('a player with no top 8 has no highlights', () => {
    const profile = profileOf([placement({ placement: 9 })])

    expect(highlightTournamentIds(profile, now)).toEqual([])
  })

  test('lists the highlights of every filter once', () => {
    const solo = [1, 2, 3, 4, 5].map((place) =>
      placement({ mode: 1, tournamentId: `solo-${place}`, tournamentName: `Solo ${place}`, placement: place }),
    )

    const duo = [1, 2].map((place) =>
      placement({ mode: 2, tournamentId: `duo-${place}`, tournamentName: `Duo ${place}`, placement: place }),
    )

    const tournamentIds = highlightTournamentIds(profileOf([...solo, ...duo]), now)

    expect(tournamentIds.toSorted()).toEqual(['duo-1', 'duo-2', 'solo-1', 'solo-2', 'solo-3', 'solo-4'])
  })

  test('old 1sts lose to top 8s from the last year', () => {
    const tournamentIds = pickedIds([
      placement({ tournamentId: 'old-first', tournamentName: 'Old Cup', placement: 1, startTime: daysBefore(500) }),
      placement({ tournamentId: 'older-first', tournamentName: 'Older Cup', placement: 1, startTime: daysBefore(900) }),
      placement({ tournamentId: 'eighth', tournamentName: 'Eighth Cup', placement: 8, startTime: daysBefore(20) }),
      placement({ tournamentId: 'fifth', tournamentName: 'Fifth Cup', placement: 5, startTime: daysBefore(40) }),
      placement({ tournamentId: 'seventh', tournamentName: 'Seventh Cup', placement: 7, startTime: daysBefore(60) }),
      placement({ tournamentId: 'third', tournamentName: 'Third Cup', placement: 3, startTime: daysBefore(300) }),
    ])

    expect(tournamentIds).toEqual(['third', 'fifth', 'seventh', 'eighth'])
  })

  test('fewer than four recent top 8s are followed by the newest older top 8s', () => {
    const tournamentIds = pickedIds([
      placement({
        tournamentId: 'recent-eighth',
        tournamentName: 'Late Cup',
        placement: 8,
        startTime: daysBefore(100),
      }),
      placement({ tournamentId: 'recent-fifth', tournamentName: 'Fifth Cup', placement: 5, startTime: daysBefore(10) }),
      placement({ tournamentId: 'old-ninth', tournamentName: 'Ninth Cup', placement: 9, startTime: daysBefore(380) }),
      placement({ tournamentId: 'old-second', tournamentName: 'Second Cup', placement: 2, startTime: daysBefore(400) }),
      placement({ tournamentId: 'old-third', tournamentName: 'Third Cup', placement: 3, startTime: daysBefore(500) }),
      placement({ tournamentId: 'old-first', tournamentName: 'First Cup', placement: 1, startTime: daysBefore(900) }),
    ])

    expect(tournamentIds).toEqual(['recent-fifth', 'recent-eighth', 'old-second', 'old-third'])
  })

  test('with nothing in the last year the newest top 8s lead', () => {
    const tournamentIds = pickedIds([
      placement({ tournamentId: 'tenth', tournamentName: 'Tenth Cup', placement: 10, startTime: daysBefore(370) }),
      placement({ tournamentId: 'fourth', tournamentName: 'Fourth Cup', placement: 4, startTime: daysBefore(400) }),
      placement({ tournamentId: 'sixth', tournamentName: 'Sixth Cup', placement: 6, startTime: daysBefore(450) }),
      placement({ tournamentId: 'second', tournamentName: 'Second Cup', placement: 2, startTime: daysBefore(700) }),
      placement({ tournamentId: 'seventh', tournamentName: 'Seventh Cup', placement: 7, startTime: daysBefore(800) }),
      placement({ tournamentId: 'first', tournamentName: 'First Cup', placement: 1, startTime: daysBefore(1000) }),
    ])

    expect(tournamentIds).toEqual(['fourth', 'sixth', 'second', 'seventh'])
  })

  test('a BCX 7th leads a Galaxy Cup 3rd, and a Champs 3rd leads both', () => {
    const tournamentIds = pickedIds([
      placement({
        tournamentId: 'galaxy-third',
        tournamentName: 'Galaxy Cup: Titan - EU 1v1',
        placement: 3,
        startTime: daysBefore(10),
      }),
      placement({
        tournamentId: 'bcx-seventh',
        tournamentName: 'Brawlhalla World Championship Expo 2025 - 1v1',
        isOfficial: true,
        placement: 7,
        startTime: daysBefore(200),
      }),
      placement({
        tournamentId: 'champs-third',
        tournamentName: 'Spring Championship - Europe 2026 - 1v1',
        isOfficial: true,
        placement: 3,
        startTime: daysBefore(240),
      }),
    ])

    expect(tournamentIds).toEqual(['champs-third', 'bcx-seventh', 'galaxy-third'])
  })

  test('the same score goes to the higher tier, then the newer', () => {
    const tournamentIds = pickedIds([
      // a trial 5th online scores 60, the same as a community 2nd
      placement({
        tournamentId: 'trial-fifth',
        tournamentName: 'Trial of Frigg - Europe (Brawl League)',
        isOfficial: true,
        placement: 5,
        startTime: daysBefore(200),
      }),
      placement({ tournamentId: 'cup-second-old', tournamentName: 'Old Cup', placement: 2, startTime: daysBefore(90) }),
      placement({ tournamentId: 'cup-second-new', tournamentName: 'New Cup', placement: 2, startTime: daysBefore(30) }),
    ])

    expect(tournamentIds).toEqual(['trial-fifth', 'cup-second-new', 'cup-second-old'])
  })

  test('a Champs 4th and 5th lead community 1sts of the same score', () => {
    const tournamentIds = pickedIds([
      placement({
        tournamentId: 'champs-fourth',
        tournamentName: 'Autumn Championship - Europe 2026 - 1v1',
        isOfficial: true,
        placement: 4,
        startTime: daysBefore(100),
      }),
      placement({
        tournamentId: 'champs-fifth',
        tournamentName: 'Summer Championship - Europe 2026 - 1v1',
        isOfficial: true,
        placement: 5,
        startTime: daysBefore(150),
      }),
      // in person a community 1st scores 100, online 80
      placement({
        tournamentId: 'lan-first',
        tournamentName: 'Local Smash Night',
        isOnline: false,
        placement: 1,
        startTime: daysBefore(10),
      }),
      placement({
        tournamentId: 'cup-first',
        tournamentName: 'Galaxy Cup: Titan',
        placement: 1,
        startTime: daysBefore(5),
      }),
    ])

    expect(tournamentIds).toEqual(['champs-fourth', 'lan-first', 'champs-fifth', 'cup-first'])
  })

  test('the same score at the same tier goes to the better placement, then the newer', () => {
    const tournamentIds = pickedIds([
      // a community 5th in person scores 40, the same as a community 4th online
      placement({
        tournamentId: 'lan-fifth',
        tournamentName: 'Local Smash Night',
        isOnline: false,
        placement: 5,
        startTime: daysBefore(5),
      }),
      placement({ tournamentId: 'cup-fourth-old', tournamentName: 'Old Cup', placement: 4, startTime: daysBefore(90) }),
      placement({ tournamentId: 'cup-fourth-new', tournamentName: 'New Cup', placement: 4, startTime: daysBefore(30) }),
    ])

    expect(tournamentIds).toEqual(['cup-fourth-new', 'cup-fourth-old', 'lan-fifth'])
  })

  test('older top 8s fill by date however much they scored', () => {
    const tournamentIds = pickedIds([
      placement({ tournamentId: 'recent-eighth', tournamentName: 'Late Cup', placement: 8, startTime: daysBefore(20) }),
      placement({
        tournamentId: 'old-bcx-first',
        tournamentName: 'Brawlhalla World Championship Expo 2024',
        isOfficial: true,
        isOnline: false,
        placement: 1,
        startTime: daysBefore(400),
      }),
      placement({ tournamentId: 'newer-cup', tournamentName: 'Newer Cup', placement: 8, startTime: daysBefore(380) }),
      placement({ tournamentId: 'older-cup', tournamentName: 'Older Cup', placement: 2, startTime: daysBefore(420) }),
      placement({ tournamentId: 'oldest-cup', tournamentName: 'Oldest Cup', placement: 1, startTime: daysBefore(800) }),
    ])

    expect(tournamentIds).toEqual(['recent-eighth', 'newer-cup', 'old-bcx-first', 'older-cup'])
  })

  test('a finish exactly 365 days ago still counts as recent', () => {
    const justOutside = new Date(daysBefore(365).getTime() - 1000)

    const tournamentIds = pickedIds([
      placement({ tournamentId: 'outside-first', tournamentName: 'Outside Cup', placement: 1, startTime: justOutside }),
      placement({ tournamentId: 'edge-sixth', tournamentName: 'Edge Cup', placement: 6, startTime: daysBefore(365) }),
      placement({ tournamentId: 'recent-eighth', tournamentName: 'Late Cup', placement: 8, startTime: daysBefore(10) }),
    ])

    // counted as older, the edge finish would trail the recent 8th
    expect(tournamentIds).toEqual(['edge-sixth', 'recent-eighth', 'outside-first'])
  })
})
