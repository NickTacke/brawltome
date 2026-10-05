import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import {
  createPostgresLeaderboardPlayerNames,
  createPostgresPlayerNameVerifications,
  playerMigrationInventory,
} from '../composition'

const baseUrl = process.env.DATABASE_URL
const databaseName = `bt_player_verify_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
let admin: ReturnType<typeof postgres>
let control: ReturnType<typeof postgres>
let connectionString = ''
let verifications: ReturnType<typeof createPostgresPlayerNameVerifications>

const now = new Date('2026-10-05T12:00:00Z')
const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs
const ago = (ms: number) => new Date(now.getTime() - ms)
const policy = { now, perWindow: 24, windowMs: 15 * 60 * 1000, dedupeMs: 14 * dayMs, staleRecheckMs: 60 * dayMs }
const ids = async (input: Partial<typeof policy> & { demandIds?: number[] } = {}) =>
  (await verifications.candidates({ ...policy, ...input })).candidates.map(({ brawlhallaId }) => brawlhallaId)

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Player PostgreSQL tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  control = postgres(connectionString, { max: 1, onnotice: () => {} })
  for (const migration of playerMigrationInventory) await control.unsafe(migration.sql)
  verifications = createPostgresPlayerNameVerifications(connectionString)
}, 20_000)

afterAll(async () => {
  await verifications?.close()
  await control?.end()
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
})

beforeEach(async () => {
  await control`
    TRUNCATE players.ranked_profiles, players.career_profiles, players.leaderboard_name_observations,
      players.name_verifications CASCADE
  `
})

async function ranked(
  brawlhallaId: number,
  name: string,
  observedAt: string | Date,
  standing: { rating?: number; globalRank?: number | null } = {},
) {
  await control`
    INSERT INTO players.ranked_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, region, rating, peak_rating, tier, wins, games,
       global_rank)
    VALUES (${brawlhallaId}, ${name}, ${observedAt}, ${observedAt}, 'EU', ${standing.rating ?? 2000}, 2100,
      'Diamond', 1, 2, ${standing.globalRank ?? null})
    ON CONFLICT (brawlhalla_id) DO UPDATE
    SET player_name = EXCLUDED.player_name, last_success_at = EXCLUDED.last_success_at
  `
}

async function career(brawlhallaId: number, name: string, observedAt: string) {
  await control`
    INSERT INTO players.career_profiles
      (brawlhalla_id, player_name, checked_at, last_success_at, xp, level, xp_percentage, games, wins,
       match_time, damage_bomb, damage_mine, damage_spikeball, damage_sidekick, snowball_hits, bomb_kos,
       mine_kos, spikeball_kos, sidekick_kos, snowball_kos)
    VALUES
      (${brawlhallaId}, ${name}, ${observedAt}, ${observedAt}, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  `
}

async function board(brawlhallaId: number, name: string, observedAt: string | Date, previous: string | null = null) {
  await control`
    INSERT INTO players.leaderboard_name_observations (brawlhalla_id, player_name, observed_at, previous_player_name)
    VALUES (${brawlhallaId}, ${name}, ${observedAt}, ${previous})
    ON CONFLICT (brawlhalla_id) DO UPDATE
    SET player_name = EXCLUDED.player_name, observed_at = EXCLUDED.observed_at,
      previous_player_name = EXCLUDED.previous_player_name
  `
}

async function attempt(
  brawlhallaId: number,
  name: string,
  checkedAt: Date,
  outcome: 'pending' | 'renamed' | 'confirmed_stale' | 'failed',
  options: { failures?: number; observedAt?: string | Date; spent?: boolean } = {},
) {
  await control`
    INSERT INTO players.name_verifications
      (brawlhalla_id, player_name, v0_name, v0_observed_at, observed_at, checked_at, outcome, spent, failures)
    VALUES (${brawlhallaId}, ${name}, 'Old', '2026-06-01T00:00:00Z', ${options.observedAt ?? '2026-10-05T00:00:00Z'},
      ${checkedAt}, ${outcome}, ${options.spent ?? true}, ${options.failures ?? 0})
  `
}

describe('Player name verification candidates', () => {
  test('selects only leaderboard names newer than and different from the live V0 name', async () => {
    await ranked(1, 'Old Name', '2026-06-01T00:00:00Z')
    await board(1, 'New Name', '2026-10-05T00:00:00Z')
    // Same name, and the same name through UTF-8-as-Latin-1 mojibake, are matches.
    await ranked(2, 'Same', '2026-06-01T00:00:00Z')
    await board(2, 'Same', '2026-10-05T00:00:00Z')
    await ranked(3, 'Müller', '2026-06-01T00:00:00Z')
    await board(3, 'MÃ¼ller', '2026-10-05T00:00:00Z')
    // A V0 refresh after the leaderboard observation already settled it: the V1 name is the cached one.
    await ranked(4, 'Fresh V0', '2026-10-05T06:00:00Z')
    await board(4, 'Cached V1', '2026-10-05T00:00:00Z')
    // A fresh career snapshot settles it too.
    await ranked(5, 'Old Ranked', '2026-06-01T00:00:00Z')
    await career(5, 'Fresh Career', '2026-10-05T06:00:00Z')
    await board(5, 'Cached V1', '2026-10-05T00:00:00Z')
    // Without a live V0 name the leaderboard name is already canonical.
    await board(6, 'Only Board', '2026-10-05T00:00:00Z')
    // A live V0 career snapshot alone is enough to verify; the executor's ranked refresh creates the ranked profile.
    await career(7, 'Career Only', '2026-06-01T00:00:00Z')
    await board(7, 'Board Name', '2026-10-05T00:00:00Z')

    expect(await verifications.candidates(policy)).toEqual({
      backlog: { rename_signal: 0, demand: 0, other: 2 },
      candidates: [
        { brawlhallaId: 1, playerName: 'New Name', v0Name: 'Old Name' },
        { brawlhallaId: 7, playerName: 'Board Name', v0Name: 'Career Only' },
      ],
    })
  })

  test('orders rename signals, then demand, then standing and the oldest V0 observation', async () => {
    const stale = '2026-06-01T00:00:00Z'
    // Plain mismatches, ordered by global rank, rating, then V0 age.
    await ranked(1, 'A', stale, { rating: 1500 })
    await ranked(2, 'A', stale, { rating: 2900, globalRank: 3 })
    await ranked(3, 'A', stale, { rating: 2950, globalRank: 1 })
    await ranked(4, 'A', '2026-01-01T00:00:00Z', { rating: 1500 })
    for (const id of [1, 2, 3, 4]) await board(id, 'B', '2026-10-05T00:00:00Z')
    // V1 itself saw the rename away from the V0 name.
    await ranked(5, 'A', stale, { rating: 1000 })
    await board(5, 'B', '2026-10-05T00:00:00Z', 'A')
    await ranked(6, 'Müller', stale, { rating: 900 })
    await board(6, 'B', '2026-10-05T00:00:00Z', 'MÃ¼ller')
    // Demanded players, one whose leaderboard name changed between other cached names.
    await ranked(7, 'A', stale, { rating: 800 })
    await board(7, 'B', '2026-10-05T00:00:00Z')
    await ranked(8, 'A', stale, { rating: 700 })
    await board(8, 'B', '2026-10-05T00:00:00Z', 'C')
    // A changed-but-unconfirmed name ranks above mismatches present since the first observation.
    await ranked(9, 'A', stale, { rating: 600 })
    await board(9, 'B', '2026-10-05T00:00:00Z', 'C')

    expect(await ids({ demandIds: [7, 8] })).toEqual([5, 6, 8, 7, 9, 3, 2, 4, 1])
    expect((await verifications.candidates({ ...policy, demandIds: [7, 8] })).backlog).toEqual({
      rename_signal: 2,
      demand: 2,
      other: 5,
    })
  })
})

describe('Player name verification suppression', () => {
  test('a confirmed stale name is not rechecked until the leaderboard moves or 60 days pass', async () => {
    const observedAt = '2026-08-01T00:00:00Z'
    // Verified 30 days ago: V0 kept "Old", so the V0 observation is newer than the cached V1 name.
    await ranked(1, 'Old', ago(30 * dayMs))
    await board(1, 'Cached', observedAt)
    await attempt(1, 'Cached', ago(30 * dayMs), 'confirmed_stale', { observedAt })
    await ranked(2, 'Old', ago(61 * dayMs))
    await board(2, 'Cached', observedAt)
    await attempt(2, 'Cached', ago(61 * dayMs), 'confirmed_stale', { observedAt })
    // The leaderboard moved on to another name: a new pair.
    await ranked(3, 'Old', ago(30 * dayMs))
    await board(3, 'Another', ago(dayMs))
    await attempt(3, 'Cached', ago(30 * dayMs), 'confirmed_stale', { observedAt })
    // It flipped back to the stale name after showing another one.
    await ranked(4, 'Old', ago(20 * dayMs))
    await board(4, 'Cached', ago(dayMs))
    await attempt(4, 'Cached', ago(20 * dayMs), 'confirmed_stale', { observedAt })
    // ...but never more than once per pair inside the dedupe window.
    await ranked(5, 'Old', ago(10 * dayMs))
    await board(5, 'Cached', ago(dayMs))
    await attempt(5, 'Cached', ago(10 * dayMs), 'confirmed_stale', { observedAt })

    expect(await ids()).toEqual([2, 3, 4])
  })

  test('failed checks back off for 1h, 6h, then 24h; pending claims hold for a day', async () => {
    const cases: [number, number, number, boolean][] = [
      // [id, failures, hours since check, eligible]
      [1, 1, 0.5, false],
      [2, 1, 2, true],
      [3, 2, 2, false],
      [4, 2, 7, true],
      [5, 3, 23, false],
      [6, 7, 25, true],
    ]
    for (const [id, failures, hours] of cases) {
      await ranked(id, 'Old', '2026-06-01T00:00:00Z')
      await board(id, 'New', '2026-10-05T00:00:00Z')
      await attempt(id, 'New', ago(hours * hourMs), 'failed', { failures })
    }
    await ranked(7, 'Old', '2026-06-01T00:00:00Z')
    await board(7, 'New', '2026-10-05T00:00:00Z')
    await attempt(7, 'New', ago(23 * hourMs), 'pending')
    await ranked(8, 'Old', '2026-06-01T00:00:00Z')
    await board(8, 'New', '2026-10-05T00:00:00Z')
    await attempt(8, 'New', ago(25 * hourMs), 'pending')

    expect((await ids()).sort()).toEqual([2, 4, 6, 8])
  })
})

describe('Player name verification claims', () => {
  test('claims at most the per-window cap, counting only spent checks in the rolling window', async () => {
    for (const id of [1, 2, 3, 4, 5, 6]) {
      await ranked(id, 'Old', '2026-06-01T00:00:00Z', { rating: 3000 - id })
      await board(id, 'New', '2026-10-05T00:00:00Z')
    }
    await attempt(100, 'Elsewhere', ago(5 * 60 * 1000), 'renamed')
    await attempt(101, 'Free', ago(5 * 60 * 1000), 'renamed', { spent: false })
    await attempt(102, 'Expired', ago(20 * 60 * 1000), 'renamed')

    const first = await verifications.claim({ ...policy, perWindow: 3 })
    expect(first).toEqual({
      backlog: { rename_signal: 0, demand: 0, other: 6 },
      usedInWindow: 1,
      claimed: [
        { brawlhallaId: 1, playerName: 'New', v0Name: 'Old' },
        { brawlhallaId: 2, playerName: 'New', v0Name: 'Old' },
      ],
    })
    expect(await verifications.claim({ ...policy, perWindow: 3 })).toEqual({
      backlog: { rename_signal: 0, demand: 0, other: 4 },
      usedInWindow: 3,
      claimed: [],
    })
    // Unexecuted claims keep counting however long they wait, so settle the first batch before the window rolls.
    await verifications.recordChecked(1, 'New')
    await verifications.recordChecked(2, 'New')
    const later = await verifications.claim({ ...policy, now: new Date(now.getTime() + 16 * 60 * 1000) })
    expect(later.claimed.map(({ brawlhallaId }) => brawlhallaId)).toEqual([3, 4, 5, 6])

    await verifications.release(3, 'New')
    expect((await verifications.claim({ ...policy, now: new Date(now.getTime() + 17 * 60 * 1000) })).claimed).toEqual([
      { brawlhallaId: 3, playerName: 'New', v0Name: 'Old' },
    ])
  })

  test('claims still pending count toward the window even when queue delay outlasts it', async () => {
    for (const id of [1, 2, 3]) {
      await ranked(id, 'Old', '2026-06-01T00:00:00Z', { rating: 3000 - id })
      await board(id, 'New', '2026-10-05T00:00:00Z')
    }
    await attempt(100, 'Delayed A', ago(40 * 60 * 1000), 'pending')
    await attempt(101, 'Delayed B', ago(30 * 60 * 1000), 'pending')
    // Past the pending hold the claim is abandoned and no longer counts.
    await attempt(102, 'Abandoned', ago(25 * hourMs), 'pending')

    const blocked = await verifications.claim({ ...policy, perWindow: 2 })
    expect(blocked.claimed).toEqual([])
    expect(blocked.usedInWindow).toBe(2)
    const open = await verifications.claim({ ...policy, perWindow: 3 })
    expect(open.claimed.map(({ brawlhallaId }) => brawlhallaId)).toEqual([1])
  })

  test('records renamed, confirmed stale, and failed outcomes', async () => {
    await ranked(1, 'Old One', '2026-06-01T00:00:00Z')
    await board(1, 'New One', '2026-10-05T00:00:00Z')
    await ranked(2, 'Old Two', '2026-06-01T00:00:00Z')
    await board(2, 'Cached Two', '2026-10-05T00:00:00Z')
    await ranked(3, 'Old Three', '2026-06-01T00:00:00Z')
    await board(3, 'New Three', '2026-10-05T00:00:00Z')
    expect((await verifications.claim(policy)).claimed).toHaveLength(3)

    // The verification's ranked refresh rewrote the profiles: 1 renamed, 2 kept its old name.
    await ranked(1, 'New One', now)
    await ranked(2, 'Old Two', now)

    expect(await verifications.recordChecked(1, 'New One')).toBe('renamed')
    expect(await verifications.recordChecked(2, 'Cached Two')).toBe('confirmed_stale')
    expect(await verifications.recordFailed(3, 'New Three')).toBe('failed')
    const rows = await control<{ outcome: string; failures: number; spent: boolean }[]>`
      SELECT outcome, failures, spent FROM players.name_verifications ORDER BY brawlhalla_id
    `
    expect([...rows]).toEqual([
      { outcome: 'renamed', failures: 0, spent: true },
      { outcome: 'confirmed_stale', failures: 0, spent: true },
      { outcome: 'failed', failures: 1, spent: true },
    ])
    expect((await verifications.candidates(policy)).candidates).toEqual([])
  })

  test('a normal ranked refresh after the claim resolves it for free; a moved leaderboard drops it', async () => {
    await ranked(1, 'Old', '2026-06-01T00:00:00Z')
    await board(1, 'New', '2026-10-05T00:00:00Z')
    await ranked(2, 'Old', '2026-06-01T00:00:00Z')
    await board(2, 'Cached', '2026-10-05T00:00:00Z')
    await ranked(3, 'Old', '2026-06-01T00:00:00Z')
    await board(3, 'New', '2026-10-05T00:00:00Z')
    await ranked(4, 'Old', '2026-06-01T00:00:00Z')
    await board(4, 'New', '2026-10-05T00:00:00Z')
    expect((await verifications.claim(policy)).claimed).toHaveLength(4)

    // A profile visit refreshed players 1 and 2 before the verification ran.
    await ranked(1, 'New', '2026-10-05T11:00:00Z')
    await ranked(2, 'Old', '2026-10-05T11:00:00Z')
    await board(3, 'Newer', '2026-10-05T11:00:00Z')

    expect(await verifications.prepare(1, 'New')).toEqual({ state: 'resolved', outcome: 'renamed' })
    expect(await verifications.prepare(2, 'Cached')).toEqual({ state: 'resolved', outcome: 'confirmed_stale' })
    expect(await verifications.prepare(3, 'New')).toEqual({ state: 'obsolete' })
    expect(await verifications.prepare(4, 'New')).toEqual({ state: 'needed' })
    const rows = await control<{ brawlhalla_id: number; outcome: string; spent: boolean }[]>`
      SELECT brawlhalla_id, outcome, spent FROM players.name_verifications ORDER BY brawlhalla_id
    `
    expect([...rows]).toEqual([
      { brawlhalla_id: 1, outcome: 'renamed', spent: false },
      { brawlhalla_id: 2, outcome: 'confirmed_stale', spent: false },
      { brawlhalla_id: 4, outcome: 'pending', spent: true },
    ])
    expect((await verifications.claim(policy)).usedInWindow).toBe(1)
  })

  test('leaderboard scans remember the name a player was seen with before a change', async () => {
    const names = createPostgresLeaderboardPlayerNames(connectionString)
    try {
      await names.applyLeaderboardNames({ observedAt: ago(hourMs), players: [{ brawlhallaId: 1, name: 'First' }] })
      await names.applyLeaderboardNames({ observedAt: now, players: [{ brawlhallaId: 1, name: 'Second' }] })
      const [row] = await control<{ player_name: string; previous_player_name: string | null }[]>`
        SELECT player_name, previous_player_name FROM players.leaderboard_name_observations
      `
      expect(row).toEqual({ player_name: 'Second', previous_player_name: 'First' })
    } finally {
      await names.close()
    }
  })
})
