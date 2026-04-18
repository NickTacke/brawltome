import { describe, expect, mock, test } from 'bun:test'
import type { ParsedReplay } from '@brawltome/replay-format'
import { IngestError, ingestReplay } from '../commands/ingestReplay'
import type { MatchRepo } from '../match.repo'

const validParsed: ParsedReplay = {
  formatVersion: 264,
  randomSeed: 12345,
  playlistId: 8,
  playlistName: 'PlaylistType_2v2Unranked_DisplayName',
  onlineGame: true,
  gameSettings: {
    flags: 0,
    maxPlayers: 4,
    duration: 480,
    roundDuration: 0,
    startingLives: 3,
    scoringTypeId: 2,
    scoreToWin: 0,
    gameSpeed: 100,
    damageMultiplier: 100,
    levelSetId: 0,
    itemSpawnRuleSetId: 0,
    weaponSpawnRateId: 0,
    gadgetSpawnRateId: 0,
    customGadgetSelection: 0,
    variation: 0,
  },
  levelId: 223,
  heroCount: 1,
  entities: [
    makeEntity(1, 'Alice', 1, 18),
    makeEntity(2, 'Bob', 1, 52),
    makeEntity(3, 'Carol', 2, 16),
    makeEntity(4, 'Dan', 2, 65),
  ],
  results: [{ lengthMs: 177872, scores: { 1: 2, 2: 2, 3: 1, 4: 1 }, endOfMatchFanfareId: 2 }],
  koFaces: [
    { entityId: 1, timestampMs: 60000 },
    { entityId: 3, timestampMs: 100000 },
  ],
  victoryFaces: null,
  gameDataChecksum: 83,
}

function makeEntity(id: number, name: string, team: number, heroId: number) {
  return {
    id,
    name,
    team,
    isBot: false,
    playerData: {
      colorSchemeId: 0,
      spawnBotId: 0,
      companionId: 0,
      emitterId: 0,
      trailEffectId: 0,
      playerThemeId: 0,
      taunts: [0, 0, 0, 0, 0, 0, 0, 0],
      winTauntId: 0,
      loseTauntId: 0,
      avatarId: 0,
      connectionTime: 0,
      heroes: [
        {
          heroId,
          costumeId: 100,
          stanceIndex: 0,
          weaponSkin1: 0,
          weaponSkin2: 0,
          morphWeapon2: false,
        },
      ],
    },
  }
}

function mockRepo(overrides: Partial<MatchRepo> = {}): MatchRepo {
  const repo: MatchRepo = {
    findBySlug: mock(async () => null),
    findByDedupeHash: mock(async () => null),
    findPlayers: mock(async () => []),
    findEvents: mock(async () => []),
    listByPlayer: mock(async () => []),
    insertMatch: mock(async () => {}),
    insertPlayers: mock(async () => {}),
    insertEvents: mock(async () => {}),
    listPendingByFormatVersion: mock(async () => []),
    markParsed: mock(async () => {}),
    updatePlayerCosmetics: mock(async () => {}),
    deleteMatch: mock(async () => {}),
    transaction: async (fn) => fn(repo),
  }
  Object.assign(repo, overrides)
  return repo
}

const fakeRaw = new Uint8Array([1, 2, 3])

describe('ingestReplay', () => {
  test('rejects empty entityBhids as scanner_not_ready', async () => {
    await expect(
      ingestReplay(
        {
          matchRepo: mockRepo(),
          r2Put: mock(async () => {}),
          reparseRaw: () => validParsed,
        },
        {
          userId: 'u1',
          parsedReplay: validParsed,
          entityBhids: {},
          rawBytes: fakeRaw,
          formatVersion: 264,
        },
      ),
    ).rejects.toMatchObject({ code: 'scanner_not_ready' })
  })

  test('rejects parsedReplay mismatch as tampered', async () => {
    const tampered = { ...validParsed, levelId: 999 }
    await expect(
      ingestReplay(
        {
          matchRepo: mockRepo(),
          r2Put: mock(async () => {}),
          reparseRaw: () => validParsed,
        },
        {
          userId: 'u1',
          parsedReplay: tampered,
          entityBhids: { 1: 100 },
          rawBytes: fakeRaw,
          formatVersion: 264,
        },
      ),
    ).rejects.toMatchObject({ code: 'tampered' })
  })

  test('returns alreadyIngested when dedupe hit', async () => {
    const existing = { slug: 'EXISTING99' } as MatchRow
    const repo = mockRepo({ findByDedupeHash: mock(async () => existing) })
    const res = await ingestReplay(
      { matchRepo: repo, r2Put: mock(async () => {}), reparseRaw: () => validParsed },
      {
        userId: 'u1',
        parsedReplay: validParsed,
        entityBhids: { 1: 100, 2: 101, 3: 102, 4: 103 },
        rawBytes: fakeRaw,
        formatVersion: 264,
      },
    )
    expect(res).toEqual({ slug: 'EXISTING99', alreadyIngested: true })
  })

  test('happy path uploads to R2 and writes match, players, events', async () => {
    const put = mock(async () => {})
    const inserts: string[] = []
    const repo = mockRepo({
      insertMatch: mock(async (row) => {
        inserts.push(`match:${(row as { slug: string }).slug}`)
      }),
      insertPlayers: mock(async (rows) => {
        inserts.push(`players:${(rows as unknown[]).length}`)
      }),
      insertEvents: mock(async (rows) => {
        inserts.push(`events:${(rows as unknown[]).length}`)
      }),
    })
    const res = await ingestReplay(
      { matchRepo: repo, r2Put: put, reparseRaw: () => validParsed },
      {
        userId: 'u1',
        parsedReplay: validParsed,
        entityBhids: { 1: 100, 2: 101, 3: 102, 4: 103 },
        rawBytes: fakeRaw,
        formatVersion: 264,
      },
    )
    expect(res.alreadyIngested).toBeUndefined()
    expect(res.slug).toMatch(/^[0-9A-Za-z]{9}$/)
    expect(put).toHaveBeenCalledTimes(1)
    expect(inserts).toEqual([`match:${res.slug}`, 'players:4', 'events:2'])
  })

  test('rejects when slot in entityBhids not in parsed entities', async () => {
    await expect(
      ingestReplay(
        {
          matchRepo: mockRepo(),
          r2Put: mock(async () => {}),
          reparseRaw: () => validParsed,
        },
        {
          userId: 'u1',
          parsedReplay: validParsed,
          entityBhids: { 99: 100 },
          rawBytes: fakeRaw,
          formatVersion: 264,
        },
      ),
    ).rejects.toMatchObject({ code: 'slot_mismatch' })
  })

  test('rejects oversize raw bytes', async () => {
    const huge = new Uint8Array(250 * 1024)
    await expect(
      ingestReplay(
        {
          matchRepo: mockRepo(),
          r2Put: mock(async () => {}),
          reparseRaw: () => validParsed,
        },
        {
          userId: 'u1',
          parsedReplay: validParsed,
          entityBhids: { 1: 100 },
          rawBytes: huge,
          formatVersion: 264,
        },
      ),
    ).rejects.toMatchObject({ code: 'oversize' })
  })

  test('rejects duration out of range', async () => {
    const bad = { ...validParsed, results: [{ ...validParsed.results[0], lengthMs: 99999999 }] }
    await expect(
      ingestReplay(
        {
          matchRepo: mockRepo(),
          r2Put: mock(async () => {}),
          reparseRaw: () => bad,
        },
        {
          userId: 'u1',
          parsedReplay: bad,
          entityBhids: { 1: 100 },
          rawBytes: fakeRaw,
          formatVersion: 264,
        },
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  test('rejects unknown heroId when knownHeroIds is provided', async () => {
    const bad: ParsedReplay = {
      ...validParsed,
      entities: validParsed.entities.map((e, i) =>
        i === 0
          ? {
              ...e,
              playerData: {
                ...e.playerData,
                heroes: [{ ...e.playerData.heroes[0], heroId: 99999 }],
              },
            }
          : e,
      ),
    }
    await expect(
      ingestReplay(
        {
          matchRepo: mockRepo(),
          r2Put: mock(async () => {}),
          reparseRaw: () => bad,
          knownHeroIds: new Set([18, 52, 16, 65]),
        },
        {
          userId: 'u1',
          parsedReplay: bad,
          entityBhids: { 1: 100, 2: 101, 3: 102, 4: 103 },
          rawBytes: fakeRaw,
          formatVersion: 264,
        },
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  test('rejects unknown levelId when knownLevelIds is provided', async () => {
    const bad = { ...validParsed, levelId: 99999 }
    await expect(
      ingestReplay(
        {
          matchRepo: mockRepo(),
          r2Put: mock(async () => {}),
          reparseRaw: () => bad,
          knownLevelIds: new Set([223]),
        },
        {
          userId: 'u1',
          parsedReplay: bad,
          entityBhids: { 1: 100, 2: 101, 3: 102, 4: 103 },
          rawBytes: fakeRaw,
          formatVersion: 264,
        },
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  test('accepts when knownHeroIds/knownLevelIds are not provided (backwards-compat)', async () => {
    // Use deliberately fake IDs to prove the legacy code path actually skips
    // validation, not that the IDs happen to be in some default allowlist.
    const fakeIds: ParsedReplay = {
      ...validParsed,
      levelId: 99999,
      entities: validParsed.entities.map((e) => ({
        ...e,
        playerData: {
          ...e.playerData,
          heroes: [{ ...e.playerData.heroes[0], heroId: 99998 }],
        },
      })),
    }
    const res = await ingestReplay(
      { matchRepo: mockRepo(), r2Put: mock(async () => {}), reparseRaw: () => fakeIds },
      {
        userId: 'u1',
        parsedReplay: fakeIds,
        entityBhids: { 1: 100, 2: 101, 3: 102, 4: 103 },
        rawBytes: fakeRaw,
        formatVersion: 264,
      },
    )
    expect(res.slug).toMatch(/^[0-9A-Za-z]{9}$/)
  })

  test('shutout: losing team has zero KOs, winner still inferred', async () => {
    const shutout: ParsedReplay = {
      ...validParsed,
      koFaces: [
        { entityId: 1, timestampMs: 30000 },
        { entityId: 2, timestampMs: 60000 },
        { entityId: 1, timestampMs: 90000 },
        { entityId: 2, timestampMs: 100000 },
        { entityId: 1, timestampMs: 120000 },
        { entityId: 2, timestampMs: 160000 },
      ],
    }
    const inserted: { winnerTeam: number | null }[] = []
    const repo = mockRepo({
      insertMatch: mock(async (row) => {
        inserted.push({ winnerTeam: (row as { winnerTeam: number | null }).winnerTeam })
      }),
    })
    await ingestReplay(
      { matchRepo: repo, r2Put: mock(async () => {}), reparseRaw: () => shutout },
      {
        userId: 'u1',
        parsedReplay: shutout,
        entityBhids: { 1: 100, 2: 101, 3: 102, 4: 103 },
        rawBytes: fakeRaw,
        formatVersion: 264,
      },
    )
    expect(inserted[0].winnerTeam).toBe(2)
  })

  test('rejects r2 upload failure', async () => {
    const repo = mockRepo()
    await expect(
      ingestReplay(
        {
          matchRepo: repo,
          r2Put: mock(async () => {
            throw new Error('r2 down')
          }),
          reparseRaw: () => validParsed,
        },
        {
          userId: 'u1',
          parsedReplay: validParsed,
          entityBhids: { 1: 100, 2: 101, 3: 102, 4: 103 },
          rawBytes: fakeRaw,
          formatVersion: 264,
        },
      ),
    ).rejects.toMatchObject({ code: 'r2_upload_failed' })
  })
})

type MatchRow = import('../match').MatchRow
