import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import {
  clanMigrationInventory,
  createPostgresClanDiscoverySource,
  createPostgresClans,
} from '@brawltome/clan/composition'
import postgres from 'postgres'

const dedicatedServer = 'postgres://brawltome_test:brawltome_test@127.0.0.1:55436'
const configuredServer = process.env.DATABASE_URL
const databaseName = `brawltome_clan_discovery_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''

beforeAll(async () => {
  const configured = new URL(configuredServer ?? '')
  const dedicated = new URL(dedicatedServer)
  if (
    configured.protocol !== dedicated.protocol ||
    configured.hostname !== dedicated.hostname ||
    configured.port !== dedicated.port ||
    configured.username !== dedicated.username ||
    configured.password !== dedicated.password
  ) {
    throw new Error(`Clan discovery tests require the dedicated server ${dedicatedServer}`)
  }
  const adminUrl = new URL(dedicatedServer)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const databaseUrl = new URL(dedicatedServer)
  databaseUrl.pathname = `/${databaseName}`
  connectionString = databaseUrl.toString()
  const setup = postgres(connectionString, { max: 1 })
  try {
    for (const migration of clanMigrationInventory) await setup.unsafe(migration.sql)
  } finally {
    await setup.end()
  }
}, 20_000)

afterAll(async () => {
  if (!admin) return
  await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin.end()
}, 20_000)

const profile = (clanId: number, clanName: string, clanXp: string) => ({
  clanId,
  clanName,
  clanCreateDate: new Date('2024-01-01T00:00:00.000Z'),
  clanXp,
  clanLifetimeXp: clanXp,
  notice: '',
  tags: [],
  discordInviteCode: '',
  guildPoints: '0',
  isRecruiting: false,
})

const member = (brawlhallaId: number) => ({
  brawlhallaId,
  name: `Player ${brawlhallaId}`,
  rank: 'Member',
  joinDate: new Date('2024-01-01T00:00:00.000Z'),
  xp: '1',
  guildPoints: '0',
})

const provenance = { source: 'v1-guild-stats' as const, outcome: 'success' as const }

describe('Clans discovery fact source', () => {
  test('hydrates current facts for renames, XP, membership transfer, replay, and removals', async () => {
    const clans = createPostgresClans(connectionString)
    const source = createPostgresClanDiscoverySource(connectionString)
    const control = postgres(connectionString)
    try {
      await clans.publishProfile(profile(42, 'Old Name', '10'), new Date('2024-01-01T00:00:00.000Z'), provenance)
      await clans.publishProfile(profile(84, 'Other Clan', '20'), new Date('2024-01-01T00:00:00.000Z'), provenance)
      await clans.publishRoster(42, [member(7)], new Date('2024-01-01T00:01:00.000Z'), {
        source: 'v1-guild-members',
        outcome: 'success',
      })
      const initial = await source.snapshot()
      expect(initial.facts).toEqual([
        { clanId: 42, clanName: 'Old Name', clanXp: '10', memberCount: 1 },
        { clanId: 84, clanName: 'Other Clan', clanXp: '20', memberCount: 0 },
      ])
      expect(initial.pendingEventCount).toBeGreaterThan(0)
      expect(initial.oldestPendingAt).toBeInstanceOf(Date)

      const initialEvents = await source.pendingEvents(100)
      await source.acknowledgeEvents(initialEvents.map(({ eventId }) => eventId))
      expect(await source.lag()).toBe(0)

      await clans.publishProfile(profile(42, 'New Name', '900719925474099312345'), new Date('2024-01-02'), provenance)
      await clans.publishRoster(84, [member(7)], new Date('2024-01-02T00:01:00.000Z'), {
        source: 'v1-guild-members',
        outcome: 'success',
      })
      const transferEvents = await source.pendingEvents(100)
      expect(new Set(transferEvents.map(({ clanId }) => clanId)).has(42)).toBe(true)
      expect(new Set(transferEvents.map(({ clanId }) => clanId)).has(84)).toBe(true)
      expect(transferEvents.find(({ clanId }) => clanId === 42)?.fact).toEqual({
        clanId: 42,
        clanName: 'New Name',
        clanXp: '900719925474099312345',
        memberCount: 0,
      })
      expect(transferEvents.find(({ clanId }) => clanId === 84)?.fact?.memberCount).toBe(1)

      const replayIds = transferEvents.map(({ eventId }) => eventId)
      await source.acknowledgeEvents(replayIds)
      await source.replayDeliveredEvents(replayIds)
      expect(await source.lag()).toBe(replayIds.length)

      await control`DELETE FROM clans.clans WHERE clan_id = 42`
      const removal = await source.pendingEvents(100)
      expect(removal.find(({ clanId }) => clanId === 42)?.fact).toBeNull()
    } finally {
      await Promise.all([clans.close(), source.close(), control.end()])
    }
  })

  test('trims day-old delivered events on acknowledgement and keeps recent and pending ones', async () => {
    const clans = createPostgresClans(connectionString)
    const source = createPostgresClanDiscoverySource(connectionString)
    const control = postgres(connectionString)
    try {
      await control`DELETE FROM clans.discovery_outbox`
      await clans.publishProfile(profile(501, 'Trim One', '1'), new Date('2024-02-01T00:00:00.000Z'), provenance)
      await clans.publishProfile(profile(502, 'Trim Two', '1'), new Date('2024-02-01T00:00:00.000Z'), provenance)
      const [stale, recent] = await source.pendingEvents(100)
      await source.acknowledgeEvents([stale.eventId, recent.eventId])
      await control`
        UPDATE clans.discovery_outbox SET delivered_at = clock_timestamp() - interval '25 hours'
        WHERE event_id = ${stale.eventId}
      `
      await clans.publishProfile(profile(503, 'Trim Three', '1'), new Date('2024-02-01T00:00:00.000Z'), provenance)
      const [pending] = await source.pendingEvents(100)

      await source.acknowledgeEvents(['00000000-0000-4000-8000-000000000000'])

      const remaining = await control<{ event_id: string }[]>`SELECT event_id FROM clans.discovery_outbox`
      expect(new Set(remaining.map(({ event_id }) => event_id))).toEqual(new Set([recent.eventId, pending.eventId]))
      expect(await source.lag()).toBe(1)
    } finally {
      await Promise.all([clans.close(), source.close(), control.end()])
    }
  })
})
