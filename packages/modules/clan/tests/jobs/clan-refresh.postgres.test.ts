import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import { createPostgresRefreshOperations, refreshOperationsModule } from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { clanModule, createPostgresClans } from '../../index'
import { createClanRefreshJob } from '../../jobs/clan-refresh-job'
import { activateClanRefresh, reserveClanRefresh } from '../../jobs/clan-refresh-reservation'

const clanId = 990120

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase({ label: 'clan_refresh_job', modules: [refreshOperationsModule, clanModule] })
}, 20_000)

afterAll(async () => {
  await database?.drop()
}, 20_000)

const guildStats = {
  guild_id: clanId,
  name: 'Queued Clan',
  create_date: 1660000000,
  xp: '10',
  legacy_xp: '10',
  notice: '',
  tags: [],
  discord_invite_code: '',
  guild_points: '10',
  is_recruiting: false,
}

const admitting = { admitSource: async () => ({ outcome: 'admitted' }) as const, pauseSource: async () => {} }

describe('clan refresh job on the real queue', () => {
  test('publishes a reserved refresh and settles it through the queue', async () => {
    const clans = createPostgresClans(database)

    const job = createClanRefreshJob({
      clans,
      createAdmittedSource: (admitSource) => ({
        getGuildStatsV1: async () => {
          await admitSource('brawlhalla-v1')

          return guildStats
        },
        getGuildMembersV1: async () => null,
      }),
    })

    const queue = createPostgresRefreshOperations({ database }, { jobs: [job] })
    const dedupeKey = `clan:${randomUUID()}`

    const reserved = await reserveClanRefresh(database, {
      dedupeKey,
      operationKey: dedupeKey,
      clanId,
      staleSections: ['profile'],
      provenance: { source: 'integration-test' },
      reservationTtlSeconds: 30,
    })

    if (reserved.outcome !== 'reserved') throw new Error('expected a clan reservation')

    await activateClanRefresh(database, reserved.operationId, reserved.reservationToken)

    expect(await runJobOnce(queue, job, { sourceAdmission: admitting })).toBe('succeeded')
    expect((await queue.inspect(reserved.operationId)).operation).toMatchObject({ status: 'succeeded' })
    expect((await clans.getById(clanId))?.clanName).toBe('Queued Clan')
  })
})
