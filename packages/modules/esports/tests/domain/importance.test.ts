import { describe, expect, test } from 'bun:test'
import { eventWeight, importance, type ScoredFinish } from '../../domain/importance'
import { buildLegendLookup } from '../../domain/legend-keys'
import { shapeEsportsProfile } from '../../domain/profile'
import { storedFromFixture } from './builders'

const online = (placement: number, fullName: string, isOfficial: boolean): ScoredFinish => ({
  placement,
  fullName,
  isOfficial,
  isOnline: true,
})

// the score without the tier's tie-break, which only ever adds a few thousandths
const score = (finish: ScoredFinish) => Math.round(importance(finish) * 100) / 100

const champsName = 'Autumn Championship - Europe 2026 - 1v1'
const communityName = 'Galaxy Cup: Titan - EU 1v1'

describe('event weight', () => {
  // names as brawltools sends them, taken from the saved fixtures and from production
  test.each([
    ['Brawlhalla World Championship Expo 2025 Last Chance Qualifier', 1.5],
    ['BCX 2026 Regional Qualifier - Europe', 1.5],
    ['Brawlhalla World Championship 2021', 3],
    ['Brawlhalla Winter Championship 2020', 2],
    ['Brawlhalla World Championship Expo 2025', 3],
    ['Brawlhalla World Championship Expo 2026 - 1v1', 3],
    ['Brawlhalla World Championship Expo 2025 - 2v2', 3],
    ['Spring Championship - Europe 2026 - 1v1', 2],
    ['Winter Championship - North America 2026 - 2v2', 2],
    ['North America - Autumn Championship 2023', 2],
    ['Summer Doubles Championship - Europe', 2],
    ['Autumn Doubles Championship - North America', 2],
    ['Midseason Championship 2026 1v1', 2],
    ['Midseason Championship 2026 – 2v2', 2],
    ['Trial of Frigg', 1.5],
    ['CEO 2025', 1.5],
    ['MAX MODE 2025', 1.5],
    ['Brawlhalla - Autumn Royale 2025', 1.5],
  ])('official %s weighs %p', (fullName, weight) => {
    expect(eventWeight(fullName, true)).toBe(weight)
  })

  test.each([
    'Galaxy Cup: Titan - EU 1v1',
    'FROSTBYTE #23 | EU 2v2',
    'ASCENDED - 1v1 ($2000)',
    "MW: Champion's Path 2v2s",
  ])('community %s weighs 0.8', (fullName) => {
    expect(eventWeight(fullName, false)).toBe(0.8)
  })

  test('an official name brawltools does not mark official counts as community', () => {
    expect(eventWeight('Spring Championship - Europe 2026 - 1v1', false)).toBe(0.8)
  })

  // a qualifier only leads to the event it names, so a future world championship qualifier stays other official
  test('any qualifier counts as other official, whatever event it leads to', () => {
    expect(eventWeight('Brawlhalla World Championship Expo 2027 - North America Qualifier', true)).toBe(1.5)
    expect(eventWeight('Summer Championship Qualifier - Europe 2026', true)).toBe(1.5)
  })

  test('an official event no name rule knows counts as other official', () => {
    expect(eventWeight('Some New Official Cup 2027', true)).toBe(1.5)
  })
})

describe('importance', () => {
  // a seasonal champs weighs 2, so its score is twice the placement points
  test.each([
    [1, 100],
    [2, 75],
    [3, 60],
    [4, 50],
    [5, 40],
    [6, 40],
    [7, 32],
    [8, 32],
    [9, 0],
    [33, 0],
  ])('placement %p is worth %p points', (placement, points) => {
    expect(score(online(placement, 'Spring Championship - Europe 2026 - 1v1', true))).toBe(points * 2)
  })

  test.each([
    [1, 80],
    [2, 60],
    [3, 48],
    [4, 40],
    [7, 25.6],
    [9, 0],
  ])('a community placement %p online scores %p', (placement, expected) => {
    expect(score(online(placement, 'Galaxy Cup: Titan - EU 1v1', false))).toBe(expected)
  })

  test('a BCX 7th beats a Galaxy Cup 3rd', () => {
    const bcxSeventh = score(online(7, 'Brawlhalla World Championship Expo 2025 - 1v1', true))
    const galaxyThird = score(online(3, 'Galaxy Cup: Titan - EU 1v1', false))

    expect(bcxSeventh).toBe(96)
    expect(galaxyThird).toBe(48)
  })

  test('a community 1st loses to a Champs 4th', () => {
    const communityFirst = score(online(1, 'Galaxy Cup: Titan - EU 1v1', false))
    const champsFourth = score(online(4, 'Autumn Championship - Europe 2026 - 1v1', true))

    expect(communityFirst).toBe(80)
    expect(champsFourth).toBe(100)
  })

  test('a community 1st beats a Champs 7th', () => {
    const communityFirst = score(online(1, 'FROSTBYTE #26 | EU 2v2', false))
    const champsSeventh = score(online(7, 'Autumn Championship - Europe 2026 - 2v2', true))

    expect(communityFirst).toBe(80)
    expect(champsSeventh).toBe(64)
  })

  test('a Champs 3rd beats a BCX 7th', () => {
    const champsThird = score(online(3, 'Spring Championship - Europe 2026 - 1v1', true))
    const bcxSeventh = score(online(7, 'Brawlhalla World Championship Expo 2025 - 1v1', true))

    expect(champsThird).toBe(120)
    expect(bcxSeventh).toBe(96)
  })

  test('an in-person finish counts a quarter more', () => {
    const inPerson = { ...online(7, 'Brawlhalla World Championship Expo 2026 - 1v1', true), isOnline: false }
    const communityInPerson = { ...online(2, 'Local Smash Night', false), isOnline: false }

    expect(score(inPerson)).toBe(120)
    expect(score(communityInPerson)).toBe(75)
  })

  test('an official event no name rule knows scores as other official', () => {
    expect(score(online(1, 'Some New Official Cup 2027', true))).toBe(150)
  })

  test('the shaped profile carries each result its importance', () => {
    const profile = shapeEsportsProfile(storedFromFixture(110282750), buildLegendLookup())
    const bcx = profile?.results.find((result) => result.fullName === 'Brawlhalla World Championship Expo 2026 - 1v1')

    expect(bcx).toMatchObject({ placement: 7, isOnline: false })
    expect(bcx?.importance).toBeCloseTo(120, 2)
  })
})

describe('the tier breaks a tie', () => {
  test('an in-person community 1st loses to an online Champs 4th', () => {
    const communityFirst = { ...online(1, communityName, false), isOnline: false }
    const champsFourth = online(4, champsName, true)

    expect(score(communityFirst)).toBe(100)
    expect(score(champsFourth)).toBe(100)
    expect(importance(champsFourth)).toBeGreaterThan(importance(communityFirst))
  })

  test('a community 1st loses to a Champs 5th', () => {
    const communityFirst = online(1, communityName, false)
    const champsFifth = online(5, champsName, true)

    expect(score(communityFirst)).toBe(80)
    expect(score(champsFifth)).toBe(80)
    expect(importance(champsFifth)).toBeGreaterThan(importance(communityFirst))
  })

  test('the same score at the same tier stays an exact tie, for the placement to break', () => {
    const fourthOnline = online(4, communityName, false)
    const fifthInPerson = { ...online(5, communityName, false), isOnline: false }

    expect(importance(fifthInPerson)).toBe(importance(fourthOnline))
  })

  test('the tie-break never reorders two different scores', () => {
    const names: [string, boolean][] = [
      ['Brawlhalla World Championship Expo 2026 - 1v1', true],
      [champsName, true],
      ['Trial of Frigg - Europe (Brawl League)', true],
      [communityName, false],
    ]

    const finishes = names.flatMap(([fullName, isOfficial]) =>
      [1, 2, 3, 4, 5, 6, 7, 8].flatMap((placement) =>
        [true, false].map((isOnline) => ({ placement, fullName, isOfficial, isOnline })),
      ),
    )

    for (const left of finishes) {
      for (const right of finishes) {
        if (score(left) > score(right)) expect(importance(left)).toBeGreaterThan(importance(right))
      }
    }
  })

  test('a finish below top 8 still scores 0', () => {
    expect(importance(online(9, champsName, true))).toBe(0)
  })
})
