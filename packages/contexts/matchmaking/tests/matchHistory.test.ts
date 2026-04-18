import { describe, expect, mock, test } from 'bun:test'
import type { MatchRow } from '../match'
import { decodeCursor, encodeCursor, matchHistory } from '../queries/matchHistory'

function row(slug: string, uploadedAt: Date): MatchRow {
  return {
    slug,
    dedupeHash: null,
    uploadedBy: 'u1',
    uploadedAt,
    parseStatus: 'parsed',
    formatVersion: 264,
    replayStorageKey: `replays/${slug}.replay`,
    replayBytes: 1000,
    gamePatch: null,
    randomSeed: 1,
    playlistId: 8,
    playlistName: null,
    onlineGame: 1,
    levelId: 1,
    durationMs: 1000,
    matchDurationMs: 1000,
    endOfMatchFanfareId: 1,
    winnerTeam: 1,
    scoringTypeId: 2,
    detailedStatsKey: null,
    simVersion: null,
    simRanAt: null,
  }
}

describe('matchHistory', () => {
  test('returns rows and next cursor when limit exhausted', async () => {
    const rows: MatchRow[] = Array.from({ length: 26 }, (_, i) =>
      row(String(i).padStart(9, 'A'), new Date(2026, 3, 17 - i)),
    )
    const repo = {
      listByPlayer: mock(async (_bhid: number, _cur: unknown, limit: number) => rows.slice(0, limit)),
    }
    const res = await matchHistory({ matchRepo: repo as never }, { brawlhallaId: 123, cursor: null, limit: 25 })
    expect(res.matches).toHaveLength(25)
    expect(res.nextCursor).not.toBeNull()
    expect(res.nextCursor?.slug).toBe(rows[24].slug)
  })

  test('returns no cursor when fewer results than limit', async () => {
    const repo = { listByPlayer: mock(async () => []) }
    const res = await matchHistory({ matchRepo: repo as never }, { brawlhallaId: 123, cursor: null, limit: 25 })
    expect(res.matches).toEqual([])
    expect(res.nextCursor).toBeNull()
  })
})

describe('cursor codec', () => {
  test('round-trips', () => {
    const c = { uploadedAt: new Date('2026-04-17T12:00:00Z'), slug: 'TESTSLUGX' }
    const enc = encodeCursor(c)
    const dec = decodeCursor(enc)
    expect(dec?.slug).toBe(c.slug)
    expect(dec?.uploadedAt.toISOString()).toBe(c.uploadedAt.toISOString())
  })

  test('decode returns null on garbage', () => {
    expect(decodeCursor('!!!')).toBe(null)
  })
})
