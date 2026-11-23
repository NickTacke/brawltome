import { describe, expect, test } from 'bun:test'
import { eventWeight, importance } from '../../domain/importance'
import { buildLegendLookup } from '../../domain/legend-keys'
import { shapeEsportsProfile } from '../../domain/profile'
import { storedFromFixture } from './builders'

type Finish = { placement: number; fullName: string; isOfficial: boolean; isOnline: boolean }

const online = (placement: number, fullName: string, isOfficial: boolean): Finish => ({
  placement,
  fullName,
  isOfficial,
  isOnline: true,
})

describe('event weight', () => {
  // names as brawltools sends them, taken from the saved fixtures and from production
  test.each([
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
  ])('official %s weighs %d', (fullName, weight) => {
    expect(eventWeight(fullName, true)).toBe(weight)
  })

  test.each([
    'Galaxy Cup: Titan - EU 1v1',
    'FROSTBYTE #23 | EU 2v2',
    'ASCENDED - 1v1 ($2000)',
    "MW: Champion's Path 2v2s",
  ])('community %s weighs 1', (fullName) => {
    expect(eventWeight(fullName, false)).toBe(1)
  })

  test('an official name brawltools does not mark official counts as community', () => {
    expect(eventWeight('Spring Championship - Europe 2026 - 1v1', false)).toBe(1)
  })

  test('an official event no name rule knows counts as other official', () => {
    expect(eventWeight('Some New Official Cup 2027', true)).toBe(1.5)
  })
})

describe('importance', () => {
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
  ])('a community %dth online scores %d', (placement, score) => {
    expect(importance(online(placement, 'Galaxy Cup: Titan - EU 1v1', false))).toBe(score)
  })

  test('a BCX 7th beats a Galaxy Cup 3rd', () => {
    const bcxSeventh = importance(online(7, 'Brawlhalla World Championship Expo 2025 - 1v1', true))
    const galaxyThird = importance(online(3, 'Galaxy Cup: Titan - EU 1v1', false))

    expect(bcxSeventh).toBe(96)
    expect(galaxyThird).toBe(60)
  })

  test('a Champs 3rd beats a BCX 7th', () => {
    const champsThird = importance(online(3, 'Spring Championship - Europe 2026 - 1v1', true))
    const bcxSeventh = importance(online(7, 'Brawlhalla World Championship Expo 2025 - 1v1', true))

    expect(champsThird).toBe(120)
    expect(bcxSeventh).toBe(96)
  })

  test('an in-person finish counts a quarter more', () => {
    const inPerson = { ...online(7, 'Brawlhalla World Championship Expo 2026 - 1v1', true), isOnline: false }
    const communityInPerson = { ...online(2, 'Local Smash Night', false), isOnline: false }

    expect(importance(inPerson)).toBe(120)
    expect(importance(communityInPerson)).toBe(93.75)
  })

  test('an official event no name rule knows scores as other official', () => {
    expect(importance(online(1, 'Some New Official Cup 2027', true))).toBe(150)
  })

  test('the shaped profile carries each result its importance', () => {
    const profile = shapeEsportsProfile(storedFromFixture(110282750), buildLegendLookup())
    const bcx = profile?.results.find((result) => result.fullName === 'Brawlhalla World Championship Expo 2026 - 1v1')

    expect(bcx).toMatchObject({ placement: 7, isOnline: false, importance: 120 })
  })
})
