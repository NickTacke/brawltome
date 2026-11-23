import { describe, expect, test } from 'bun:test'
import { buildLegendLookup, legendLookupFrom } from '../../domain/legend-keys'
import { shapeEsportsProfile } from '../../domain/profile'
import { fixtureIds, match, placement, powerRanking, stored, storedFromFixture } from './builders'

const legendLookup = legendLookupFrom(['mordex', 'teros', 'ulgrim'])

function shapeOne(overrides: Parameters<typeof stored>[0]) {
  return shapeEsportsProfile(stored(overrides), legendLookup)
}

describe('shapeEsportsProfile', () => {
  test('drops crew battle and triples events by name', () => {
    const sideModes = [
      'Crew Battle Cup',
      'Triples Bash',
      'Trio Night',
      'Mixed 3v3 Open',
      'Brawlball Night',
      'Kung Foot Cup',
    ]

    const placements = [
      placement({ tournamentId: 'frostbyte', tournamentName: 'Frostbyte #19' }),
      ...sideModes.map((name) => placement({ tournamentId: name, tournamentName: name })),
    ]

    const profile = shapeOne({ placements })

    expect(profile?.results.map((result) => result.fullName)).toEqual(['Frostbyte #19'])
  })

  test('keeps the best finish of an event split into pools', () => {
    const placements = [
      placement({ tournamentId: 'pool-a', tournamentName: 'Galaxy Cup', placement: 9 }),
      placement({ tournamentId: 'pool-b', tournamentName: 'Galaxy Cup', placement: 3 }),
      placement({ tournamentId: 'pool-c', tournamentName: 'Galaxy Cup', placement: 17 }),
    ]

    const profile = shapeOne({ placements })

    expect(profile?.results.map((result) => result.placement)).toEqual([3])
  })

  test('does not merge events of the same name on different days', () => {
    const placements = [
      placement({ tournamentId: 'week-1', tournamentName: 'Galaxy Cup', startTime: new Date('2026-03-01T18:00:00Z') }),
      placement({ tournamentId: 'week-2', tournamentName: 'Galaxy Cup', startTime: new Date('2026-03-08T18:00:00Z') }),
    ]

    const profile = shapeOne({ placements })

    expect(profile?.results).toHaveLength(2)
  })

  test('shows a forfeit as DQ and leaves it out of the set record', () => {
    const sets = [
      match({ matchId: 'a', scores: [2, 1] }),
      match({ matchId: 'b', scores: [-1, 2] }),
      match({ matchId: 'c', scores: [2, -1] }),
      match({ matchId: 'd', scores: [0, 2] }),
    ]

    const profile = shapeOne({
      placements: [placement()],
      setsByTournament: new Map([[placement().tournamentId, sets]]),
    })

    const [result] = profile?.results ?? []
    const forfeits = result?.sets.filter((set) => set.isForfeit)

    expect(forfeits?.map((set) => set.score)).toEqual(['DQ', 'DQ'])
    expect(result?.setRecord).toEqual({ wins: 1, losses: 1 })
  })

  test('drops a set neither side played', () => {
    const sets = [match({ matchId: 'a', scores: [-1, -1] }), match({ matchId: 'b', scores: [2, 0] })]

    const profile = shapeOne({
      placements: [placement()],
      setsByTournament: new Map([[placement().tournamentId, sets]]),
    })

    expect(profile?.results[0]?.sets.map((set) => set.id)).toEqual(['b'])
  })

  test('drops a 0-0 set', () => {
    const sets = [
      match({ matchId: 'unplayed', scores: [0, 0] }),
      match({ matchId: 'won', scores: [2, 0] }),
      match({ matchId: 'no-show', scores: [0, -1] }),
    ]

    const profile = shapeOne({
      placements: [placement()],
      setsByTournament: new Map([[placement().tournamentId, sets]]),
    })

    const [result] = profile?.results ?? []

    expect(result?.sets.map((set) => set.id).toSorted()).toEqual(['no-show', 'won'])
    expect(result?.setRecord).toEqual({ wins: 1, losses: 0 })
  })

  test('treats a Random pick and an unknown legend as no legend', () => {
    const sets = [
      match({ matchId: 'a', legends: [['RANDOM'], ['NOT A LEGEND']] }),
      match({ matchId: 'b', legends: [['MORDEX'], ['TEROS']] }),
      match({ matchId: 'c', legends: [[], []] }),
    ]

    const profile = shapeOne({
      placements: [placement()],
      setsByTournament: new Map([[placement().tournamentId, sets]]),
    })

    const [result] = profile?.results ?? []
    const [random, known, empty] = result?.sets ?? []

    expect(random?.legendKey).toBeNull()
    expect(random?.opponentLegendKey).toBeNull()
    expect(known?.legendKey).toBe('mordex')
    expect(known?.opponentLegendKey).toBe('teros')
    expect(empty?.legendKey).toBeNull()
    expect(result?.legendKey).toBe('mordex')
  })

  test('keeps only the brawlhalla id and name of each opponent, and only a real id', () => {
    const opponents = [
      { playerId: 31, sggPlayerId: 4_101, cmPlayerId: null, brawlhallaId: 7_788, name: 'Sandstorm' },
      { playerId: 32, sggPlayerId: null, cmPlayerId: 12, brawlhallaId: 0, name: 'No Account' },
      { playerId: 33, sggPlayerId: null, cmPlayerId: null, brawlhallaId: null, name: 'Unlinked' },
    ]

    const profile = shapeOne({
      placements: [placement()],
      setsByTournament: new Map([[placement().tournamentId, [match({ opponent: opponents })]]]),
    })

    expect(profile?.results[0]?.sets[0]?.opponents).toEqual([
      { brawlhallaId: 7_788, name: 'Sandstorm' },
      { brawlhallaId: null, name: 'No Account' },
      { brawlhallaId: null, name: 'Unlinked' },
    ])
  })

  test('picks the legend played most across the sets', () => {
    const sets = [
      match({ matchId: 'a', legends: [['ULGRIM'], ['TEROS']] }),
      match({ matchId: 'b', legends: [['MORDEX', 'ULGRIM'], ['TEROS']] }),
      match({ matchId: 'c', legends: [['ULGRIM'], ['TEROS']] }),
    ]

    const profile = shapeOne({
      placements: [placement()],
      setsByTournament: new Map([[placement().tournamentId, sets]]),
    })

    expect(profile?.results[0]?.legendKey).toBe('ulgrim')
  })

  test('reads a two word legend the way brawltools writes it', () => {
    const sets = [match({ legends: [['LIN_FEI', 'LIN_FEI', 'BODVAR'], ['RED_RAPTOR']] })]

    const profile = shapeEsportsProfile(
      stored({ placements: [placement()], setsByTournament: new Map([[placement().tournamentId, sets]]) }),
      buildLegendLookup(),
    )

    const [result] = profile?.results ?? []

    expect(result?.sets[0]?.legendKey).toBe('lin fei')
    expect(result?.sets[0]?.opponentLegendKey).toBe('redraptor')
    expect(result?.legendKey).toBe('lin fei')
  })

  test('gives a result with no sets setRecord null and sets []', () => {
    const profile = shapeOne({ placements: [placement()] })

    const [result] = profile?.results ?? []

    expect(result?.sets).toEqual([])
    expect(result?.setRecord).toBeNull()
  })

  test('gives a result with only forfeits setRecord null', () => {
    const sets = [match({ scores: [-1, 2] })]

    const profile = shapeOne({
      placements: [placement()],
      setsByTournament: new Map([[placement().tournamentId, sets]]),
    })

    expect(profile?.results[0]?.setRecord).toBeNull()
  })

  test('puts the first round first', () => {
    const latestFirst = [match({ matchId: 'final' }), match({ matchId: 'semi' }), match({ matchId: 'first' })]

    const profile = shapeOne({
      placements: [placement()],
      setsByTournament: new Map([[placement().tournamentId, latestFirst]]),
    })

    expect(profile?.results[0]?.sets.map((set) => set.id)).toEqual(['first', 'semi', 'final'])
  })

  test('orders by start time when every set has one', () => {
    const sets = [
      match({ matchId: 'late', startTime: 300 }),
      match({ matchId: 'early', startTime: 100 }),
      match({ matchId: 'middle', startTime: 200 }),
    ]

    const profile = shapeOne({
      placements: [placement()],
      setsByTournament: new Map([[placement().tournamentId, sets]]),
    })

    expect(profile?.results[0]?.sets.map((set) => set.id)).toEqual(['early', 'middle', 'late'])
  })

  test('keeps the same tournament id apart in 1v1 and 2v2', () => {
    const placements = [
      placement({ mode: 1, tournamentId: 'shared', placement: 4 }),
      placement({ mode: 2, tournamentId: 'shared', placement: 2 }),
    ]

    const profile = shapeOne({ placements })

    const results = profile?.results ?? []

    expect(results.map((result) => result.id).sort()).toEqual(['1v1-shared', '2v2-shared'])
    expect(results.map((result) => result.mode).sort()).toEqual(['1v1', '2v2'])
    expect(new Set(results.map((result) => `${result.title}|${result.meta}`)).size).toBe(2)
  })

  test('returns null when every placement is a side mode', () => {
    const placements = [placement({ tournamentName: 'Crew Battle Cup' }), placement({ tournamentName: 'Triples Bash' })]

    const profile = shapeOne({ placements, pr1v1: powerRanking({ rank: 12, earnings: 500 }) })

    expect(profile).toBeNull()
  })

  test('returns null when there are no placements', () => {
    expect(shapeOne({})).toBeNull()
  })

  test('earnings 0 → null; pr rank 0 → no ranking for that mode', () => {
    const profile = shapeOne({
      placements: [placement()],
      pr1v1: powerRanking({ rank: 0, earnings: 0 }),
      pr2v2: powerRanking({ rank: 7, region: 'NA' }),
    })

    expect(profile?.earnings).toBeNull()
    expect(profile?.rankings.map((ranking) => ranking.mode)).toEqual(['2v2'])
  })

  test('takes the larger earnings figure of the two modes', () => {
    const profile = shapeOne({
      placements: [placement()],
      pr1v1: powerRanking({ rank: 3, region: 'EU', earnings: 1250 }),
      pr2v2: powerRanking({ rank: 9, region: 'EU', earnings: 1250 }),
    })

    expect(profile?.earnings).toBe(1250)

    expect(profile?.rankings.map((ranking) => [ranking.mode, ranking.rank, ranking.region])).toEqual([
      ['1v1', 3, 'EU'],
      ['2v2', 9, 'EU'],
    ])
  })

  test('sorts results newest first', () => {
    const placements = [
      placement({ tournamentId: 'old', tournamentName: 'Old Cup', startTime: new Date('2025-01-10T18:00:00Z') }),
      placement({ tournamentId: 'new', tournamentName: 'New Cup', startTime: new Date('2026-05-10T18:00:00Z') }),
      placement({ tournamentId: 'mid', tournamentName: 'Mid Cup', startTime: new Date('2025-09-10T18:00:00Z') }),
    ]

    const profile = shapeOne({ placements })

    expect(profile?.results.map((result) => result.fullName)).toEqual(['New Cup', 'Mid Cup', 'Old Cup'])
  })
})

describe('shapeEsportsProfile over saved Brawltools responses', () => {
  const profiles = fixtureIds.map((brawlhallaId) => ({
    brawlhallaId,
    profile: shapeEsportsProfile(storedFromFixture(brawlhallaId), buildLegendLookup()),
  }))

  test('shapes every response', () => {
    for (const { brawlhallaId, profile } of profiles) {
      expect(profile, String(brawlhallaId)).not.toBeNull()
    }
  })

  test('no two results share title and meta', () => {
    for (const { brawlhallaId, profile } of profiles) {
      const labels = (profile?.results ?? []).map((result) => `${result.title}|${result.meta}`)

      expect(new Set(labels).size, String(brawlhallaId)).toBe(labels.length)
    }
  })

  test('titles are at most 22 characters and never end in …', () => {
    const titles = profiles.flatMap(({ profile }) => (profile?.results ?? []).map((result) => result.title))

    expect(titles.length).toBeGreaterThan(0)

    for (const title of titles) {
      expect(title.length, title).toBeLessThanOrEqual(22)
      expect(title.endsWith('…'), title).toBe(false)
    }
  })

  test('a result never carries an empty label', () => {
    const results = profiles.flatMap(({ profile }) => profile?.results ?? [])

    for (const result of results) {
      expect(result.title.length).toBeGreaterThan(0)
      expect(result.meta.length).toBeGreaterThan(0)
    }
  })

  test("Marckiem00's 4th at Apocalypse reads 5-2, the 0-0 set left out", () => {
    const profile = profiles.find(({ brawlhallaId }) => brawlhallaId === 110282750)?.profile
    const apocalypse = profile?.results.find((result) => result.fullName.startsWith('APOCALYPSE'))

    expect(apocalypse?.placement).toBe(4)
    expect(apocalypse?.setRecord).toEqual({ wins: 5, losses: 2 })
    expect(apocalypse?.sets.some((set) => set.score === '0-0')).toBe(false)
  })

  test('finds art for the legends brawltools writes with an underscore', () => {
    const sets = profiles.flatMap(({ profile }) => (profile?.results ?? []).flatMap((result) => result.sets))
    const legendKeys = new Set(sets.flatMap((set) => [set.legendKey, set.opponentLegendKey]))

    expect(legendKeys.has('queen nai')).toBe(true)
    expect(legendKeys.has('redraptor')).toBe(true)
  })
})
