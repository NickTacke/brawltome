import { describe, expect, mock, test } from 'bun:test'
import type { ParsedReplay } from '@brawltome/replay-format'
import { backfillPending } from '../commands/backfillPending'
import type { MatchRow } from '../match'
import type { MatchRepo } from '../match.repo'

function minimalRow(): MatchRow {
  return {
    slug: 'SLUG0PEND',
    dedupeHash: null,
    uploadedBy: 'u1',
    uploadedAt: new Date(),
    parseStatus: 'pending',
    formatVersion: 265,
    replayStorageKey: 'replays/SLUG0PEND.replay',
    replayBytes: 1234,
    gamePatch: null,
    randomSeed: null,
    playlistId: null,
    playlistName: null,
    onlineGame: null,
    levelId: null,
    durationMs: null,
    matchDurationMs: null,
    endOfMatchFanfareId: null,
    winnerTeam: null,
    scoringTypeId: null,
    detailedStatsKey: null,
    simVersion: null,
    simRanAt: null,
  }
}

function parsedStub(): ParsedReplay {
  return {
    formatVersion: 265,
    randomSeed: 42,
    playlistId: 8,
    playlistName: 'pl',
    onlineGame: true,
    gameSettings: {
      flags: 0,
      maxPlayers: 4,
      duration: 180,
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
    levelId: 10,
    heroCount: 1,
    entities: [
      {
        id: 1,
        name: 'A',
        team: 1,
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
              heroId: 18,
              costumeId: 583,
              stanceIndex: 1,
              weaponSkin1: 0,
              weaponSkin2: 0,
              morphWeapon2: false,
            },
          ],
        },
      },
    ],
    results: [{ lengthMs: 100, scores: { 1: 3 }, endOfMatchFanfareId: 1 }],
    koFaces: [{ entityId: 1, timestampMs: 50 }],
    victoryFaces: null,
    gameDataChecksum: 0,
  }
}

function mockRepo(overrides: Partial<MatchRepo> = {}): MatchRepo {
  return {
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
    ...overrides,
  }
}

describe('backfillPending', () => {
  test('no-ops if row is already parsed', async () => {
    const row = { ...minimalRow(), parseStatus: 'parsed' as const }
    const markParsed = mock(async () => {})
    const repo = mockRepo({ markParsed })
    await backfillPending(
      {
        matchRepo: repo,
        r2Get: mock(async () => new Uint8Array()),
        parse: () => parsedStub(),
      },
      row,
    )
    expect(markParsed).toHaveBeenCalledTimes(0)
  })

  test('happy path marks parsed, updates cosmetics, inserts ko events', async () => {
    const markParsed = mock(async () => {})
    const updateCos = mock(async () => {})
    const insertEv = mock(async () => {})
    const repo = mockRepo({
      markParsed,
      updatePlayerCosmetics: updateCos,
      insertEvents: insertEv,
    })
    await backfillPending(
      {
        matchRepo: repo,
        r2Get: mock(async () => new Uint8Array([1, 2, 3])),
        parse: () => parsedStub(),
      },
      minimalRow(),
    )
    expect(markParsed).toHaveBeenCalledTimes(1)
    expect(updateCos).toHaveBeenCalledTimes(1)
    expect(insertEv).toHaveBeenCalledTimes(1)
  })

  test('dedupe collision with existing parsed row deletes pending row', async () => {
    const deleteMatch = mock(async () => {})
    const markParsed = mock(async () => {})
    const repo = mockRepo({
      findByDedupeHash: mock(async () => ({ ...minimalRow(), slug: 'OTHERSLUG' })),
      deleteMatch,
      markParsed,
    })
    await backfillPending(
      {
        matchRepo: repo,
        r2Get: mock(async () => new Uint8Array()),
        parse: () => parsedStub(),
      },
      minimalRow(),
    )
    expect(deleteMatch).toHaveBeenCalledTimes(1)
    expect(markParsed).toHaveBeenCalledTimes(0)
  })
})
