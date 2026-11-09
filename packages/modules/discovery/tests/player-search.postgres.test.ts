import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createPostgresDiscovery, discoveryModule } from '@brawltome/discovery'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { queueModule } from '@brawltome/queue'
import postgres from 'postgres'

let database: TestDatabase
let connectionString = ''

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'discovery_player_search',
    modules: [queueModule, discoveryModule],
  })

  connectionString = database.connectionString
}, 20_000)

afterAll(async () => {
  await database?.drop()
})

const playerResults = async (discovery: ReturnType<typeof createPostgresDiscovery>, query: string) =>
  (await discovery.search(query)).players

const fact = (
  brawlhallaId: number,
  name: string,
  rating: number | null,
  viewCount: number,
  aliases: string[] = [],
  bestLegendNameKey: string | null = null,
) => ({
  brawlhallaId,
  name,
  region: 'US-E',
  rating,
  viewCount,
  bestLegendNameKey,
  aliases,
})

describe('Discovery player search', () => {
  test('normalizes terms and orders exact matches before prefixes across canonical, segment, and alias terms', async () => {
    const discovery = createPostgresDiscovery(database)

    await discovery.rebuildPlayers({
      sourceVersion: 1,
      facts: [
        fact(90, 'Team | Alpha Prime', 2500, 100),
        fact(40, 'Alpha', 1800, 10),
        fact(30, 'Canonical Prefix', 3000, 500, ['Alpha']),
        fact(20, 'Alpha Two', 2600, 200),
      ],
    })

    await expect(playerResults(discovery, '  ALPHA  ')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 40, matchedAlias: null }),
      expect.objectContaining({ brawlhallaId: 20, matchedAlias: null }),
      expect.objectContaining({ brawlhallaId: 90, matchedAlias: null }),
      expect.objectContaining({ brawlhallaId: 30, matchedAlias: 'Alpha' }),
    ])

    await expect(playerResults(discovery, ' %_\\ ')).resolves.toEqual([])

    await expect(playerResults(discovery, ' team|alpha ')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 90, name: 'Team | Alpha Prime' }),
    ])

    const explain = postgres(connectionString, { max: 1 })

    try {
      const [generation] = await explain<{ generation_id: string }[]>`
        SELECT generation_id FROM discovery.generations WHERE entity_kind = 'player' AND active
      `

      await explain`
        INSERT INTO discovery.terms
          (entity_kind, generation_id, entity_id, term_kind, display_term, normalized_term,
           canonical_name, view_count)
        SELECT 'player', ${generation.generation_id}, 100000 + value, 'canonical',
               'Noise ' || value, 'noise ' || lpad(value::text, 6, '0'),
               'Noise ' || value, 0
        FROM generate_series(1, 30000) AS value
      `

      await explain`ANALYZE discovery.terms`

      const plan = await explain`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        WITH candidates AS (
          SELECT term.*,
                 term.normalized_term = 'alpha' COLLATE "C" AND term.term_kind <> 'word' AS exact_match,
                 CASE WHEN term.term_kind = 'word' THEN 1 ELSE 0 END AS word_rank,
                 CASE WHEN term.term_kind = 'alias' THEN 1 ELSE 0 END AS alias_rank,
                 CASE term.term_kind WHEN 'canonical' THEN 0 WHEN 'segment' THEN 1 WHEN 'alias' THEN 2 ELSE 3 END
                   AS stable_term_rank
          FROM discovery.terms term
          JOIN discovery.generations generation
            ON generation.entity_kind = term.entity_kind
           AND generation.generation_id = term.generation_id AND generation.active
          WHERE term.entity_kind = 'player'
            AND term.normalized_term >= 'alpha' COLLATE "C"
            AND term.normalized_term < ${'alpha\u{10ffff}'} COLLATE "C"
        ), winners AS (
          SELECT DISTINCT ON (entity_id) *
          FROM candidates
          ORDER BY entity_id, alias_rank, exact_match DESC, word_rank, stable_term_rank,
                   normalized_term, display_term
        )
        SELECT entity_id, canonical_name, region, rating, view_count,
               best_legend_name_key, term_kind, display_term
        FROM winners
        ORDER BY alias_rank, exact_match DESC, word_rank, (rating IS NULL),
                 (best_legend_name_key IS NULL), rating DESC NULLS LAST, view_count DESC, entity_id
        LIMIT 40
      `

      const serializedPlan = JSON.stringify(plan)

      expect(serializedPlan).toContain('discovery_terms_prefix')
      expect(serializedPlan).not.toContain('Seq Scan on terms')
    } finally {
      await explain.end()
    }
  })

  test('places available players with best legends ahead of missing legends and unavailable ratings', async () => {
    const discovery = createPostgresDiscovery(database)

    await discovery.rebuildPlayers({
      sourceVersion: 2,
      facts: [
        fact(1, 'Priority Unavailable', null, 1_000, [], 'bodvar'),
        fact(2, 'Priority No Legend', 2_500, 500),
        fact(3, 'Priority Complete', 1_800, 10, [], 'asuri'),
      ],
    })

    expect((await playerResults(discovery, 'priority')).map(({ brawlhallaId }) => brawlhallaId)).toEqual([3, 2, 1])
  })

  test('deduplicates identities, caps stable ties at 40, and replays events idempotently', async () => {
    const discovery = createPostgresDiscovery(database)
    const stableTies = Array.from({ length: 45 }, (_, index) => fact(100 + index, `Prefix ${index}`, 2000, 50))

    await discovery.rebuildPlayers({ sourceVersion: 3, facts: [...stableTies].reverse() })

    const capped = await playerResults(discovery, 'prefix')

    expect(capped).toHaveLength(40)

    expect(capped.map(({ brawlhallaId }) => brawlhallaId)).toEqual(
      Array.from({ length: 40 }, (_, index) => 100 + index),
    )

    const eventId = randomUUID()

    const event = {
      eventId,
      brawlhallaId: 999,
      sourceVersion: 4,
      fact: fact(999, 'Replay Target', 2100, 70, ['Prefixed', 'Prefixed Previous']),
    }

    await expect(discovery.applyPlayerEvents([event, event])).resolves.toEqual({ appliedEvents: 1 })
    await expect(discovery.applyPlayerEvents([event])).resolves.toEqual({ appliedEvents: 0 })

    await expect(playerResults(discovery, 'prefixed')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 999, matchedAlias: 'Prefixed' }),
    ])

    await discovery.rebuildPlayers({ sourceVersion: 5, facts: [fact(777, 'Replacement', null, 0)] })
    await expect(playerResults(discovery, 'prefix')).resolves.toEqual([])

    await expect(playerResults(discovery, 'replacement')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 777, rating: null }),
    ])
  })

  test('publishes a production-shaped player generation without per-entity database round trips', async () => {
    const discovery = createPostgresDiscovery(database)

    const facts = Array.from({ length: 10_001 }, (_, index) =>
      fact(1_000_000 + index, `Scale Player ${index}`, 2000 + (index % 100), index, [`Former ${index}`]),
    )

    await discovery.rebuildPlayers({ sourceVersion: 6, facts })

    await expect(
      discovery.applyPlayerEvents(
        facts.slice(0, 1_000).map((player) => ({
          eventId: randomUUID(),
          brawlhallaId: player.brawlhallaId,
          sourceVersion: 5,
          fact: { ...player, name: `Covered Event ${player.brawlhallaId}` },
        })),
      ),
    ).resolves.toEqual({ appliedEvents: 1_000 })

    await expect(playerResults(discovery, 'scale player 0')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 1_000_000, name: 'Scale Player 0' }),
    ])

    await expect(playerResults(discovery, 'scale player 10000')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 1_010_000, matchedAlias: null }),
    ])

    await expect(playerResults(discovery, 'former 10000')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 1_010_000, matchedAlias: 'Former 10000' }),
    ])
  }, 20_000)

  test('uses the durable source watermark so delayed events and stale rebuilds cannot overwrite newer facts', async () => {
    const discovery = createPostgresDiscovery(database)

    await discovery.rebuildPlayers({ sourceVersion: 10, facts: [fact(500, 'Newest Name', 2200, 10)] })

    await expect(
      discovery.applyPlayerEvents([
        {
          eventId: randomUUID(),
          brawlhallaId: 500,
          sourceVersion: 9,
          fact: fact(500, 'Older Name', 1800, 1),
        },
      ]),
    ).resolves.toEqual({ appliedEvents: 1 })

    await expect(playerResults(discovery, 'newest')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 500, name: 'Newest Name', rating: 2200 }),
    ])

    await expect(
      discovery.rebuildPlayers({ sourceVersion: 9, facts: [fact(500, 'Stale Rebuild', 1700, 0)] }),
    ).rejects.toThrow()

    await expect(playerResults(discovery, 'newest')).resolves.toHaveLength(1)
  })

  test('applies every batch of a bulk write enqueued under one source version', async () => {
    const discovery = createPostgresDiscovery(database)

    await discovery.rebuildPlayers({ sourceVersion: 20, facts: [fact(600, 'Burst One', 1500, 0)] })

    const burst = [600, 601, 602].map((brawlhallaId) => ({
      eventId: randomUUID(),
      brawlhallaId,
      sourceVersion: 21,
      fact: fact(brawlhallaId, `Burst ${brawlhallaId}`, 1973, 0),
    }))

    await expect(discovery.applyPlayerEvents(burst.slice(0, 1))).resolves.toEqual({ appliedEvents: 1 })
    await expect(discovery.applyPlayerEvents(burst.slice(1))).resolves.toEqual({ appliedEvents: 2 })

    for (const brawlhallaId of [600, 601, 602]) {
      await expect(playerResults(discovery, `burst ${brawlhallaId}`)).resolves.toEqual([
        expect.objectContaining({ brawlhallaId, rating: 1973 }),
      ])
    }
  })

  test('finds a player from any word of their name on, below every full name match', async () => {
    const discovery = createPostgresDiscovery(database)

    await discovery.rebuildPlayers({
      sourceVersion: 30,
      facts: [
        fact(700, 'ó ¡pefura', 1500, 0),
        fact(701, 'Ahmed PickleBall', 1940, 0),
        fact(702, 'Pickle', 1200, 0),
        fact(703, '~Mira~', 1300, 0),
        fact(704, 'Gamma Ray', 2900, 0),
        fact(705, 'Raymond', 1100, 0),
        fact(706, 'THE BEST UNARMED', 1600, 0),
      ],
    })

    const ids = async (query: string) => (await playerResults(discovery, query)).map(({ brawlhallaId }) => brawlhallaId)

    // decoration around a word no longer hides the player
    expect(await ids('pefura')).toEqual([700])
    expect(await ids('mira')).toEqual([703])
    // an exact name comes first, then a word match, however their ratings compare
    expect(await ids('pickle')).toEqual([702, 701])
    // a name prefix beats a word match with a higher rating
    expect(await ids('ray')).toEqual([705, 704])
    // a search can run across the words that follow
    expect(await ids('best unarmed')).toEqual([706])
    expect(await ids('unarm')).toEqual([706])
    // a word the name starts with adds no second hit
    expect(await ids('ahmed')).toEqual([701])

    await expect(playerResults(discovery, 'pickleb')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 701, name: 'Ahmed PickleBall', matchedAlias: null }),
    ])
  })

  test('ignores accents and styled letters on both the name and the query', async () => {
    const discovery = createPostgresDiscovery(database)

    await discovery.rebuildPlayers({
      sourceVersion: 31,
      facts: [fact(710, 'La Fée', 1500, 0), fact(711, '𝓐𝓵𝓽𝓪𝓲𝓻', 1500, 0), fact(712, 'Ｚｅｎｉｔｈ', 1500, 0)],
    })

    const ids = async (query: string) => (await playerResults(discovery, query)).map(({ brawlhallaId }) => brawlhallaId)

    expect(await ids('la fee')).toEqual([710])
    expect(await ids('La Fée')).toEqual([710])
    expect(await ids('altair')).toEqual([711])
    expect(await ids('zenith')).toEqual([712])
    await expect(playerResults(discovery, 'altair')).resolves.toEqual([expect.objectContaining({ name: '𝓐𝓵𝓽𝓪𝓲𝓻' })])
  })

  test('indexes the words of a name that arrives through a projection event', async () => {
    const discovery = createPostgresDiscovery(database)

    await discovery.rebuildPlayers({ sourceVersion: 32, facts: [fact(720, 'Old Name', 1500, 0)] })

    await discovery.applyPlayerEvents([
      { eventId: randomUUID(), brawlhallaId: 720, sourceVersion: 33, fact: fact(720, '[x] Sparrow', 1500, 0) },
    ])

    expect((await playerResults(discovery, 'sparrow')).map(({ brawlhallaId }) => brawlhallaId)).toEqual([720])
    await expect(playerResults(discovery, 'name')).resolves.toEqual([])
  })

  test('lists every current name before any old name, however the ratings compare', async () => {
    const discovery = createPostgresDiscovery(database)

    await discovery.rebuildPlayers({
      sourceVersion: 40,
      facts: [
        fact(800, 'Former Prefix', 3100, 0, ['Lumen Old']),
        fact(801, 'Former Exact', 3000, 0, ['Lumen']),
        fact(802, 'Gamma Lumen', 1200, 0),
        fact(803, 'Lumen Two', 1100, 0),
        fact(804, 'Lumen', 1000, 0),
      ],
    })

    const hits = await playerResults(discovery, 'lumen')

    expect(hits.map(({ brawlhallaId }) => brawlhallaId)).toEqual([804, 803, 802, 801, 800])
    expect(hits.map(({ matchedAlias }) => matchedAlias)).toEqual([null, null, null, 'Lumen', 'Lumen Old'])
  })

  test('keeps current names when more than 40 exact old names would fill the list', async () => {
    const discovery = createPostgresDiscovery(database)

    const renamedPlayers = Array.from({ length: 45 }, (_, index) =>
      fact(900 + index, `Renamed ${index}`, 3000, 100, ['Needle']),
    )

    await discovery.rebuildPlayers({
      sourceVersion: 41,
      facts: [...renamedPlayers, fact(810, 'Needle Prefix', 1000, 0), fact(811, 'Some Needle', 900, 0)],
    })

    const hits = await playerResults(discovery, 'needle')

    expect(hits).toHaveLength(40)
    expect(hits.slice(0, 2).map(({ brawlhallaId }) => brawlhallaId)).toEqual([810, 811])
    expect(hits.slice(2).every(({ matchedAlias }) => matchedAlias === 'Needle')).toBe(true)
  })

  test('ranks a player by their current name when an old name also matches', async () => {
    const discovery = createPostgresDiscovery(database)

    await discovery.rebuildPlayers({
      sourceVersion: 42,
      facts: [
        fact(820, 'Other Name', 3000, 0, ['Beacon']),
        fact(821, 'Zed Beacon', 1900, 0, ['Beacon Old']),
        fact(822, 'Beacon Two', 2000, 0, ['Beacon']),
      ],
    })

    await expect(playerResults(discovery, 'beacon')).resolves.toEqual([
      expect.objectContaining({ brawlhallaId: 822, matchedAlias: null }),
      expect.objectContaining({ brawlhallaId: 821, matchedAlias: null }),
      expect.objectContaining({ brawlhallaId: 820, matchedAlias: 'Beacon' }),
    ])
  })
})
