import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { accountsTestModules } from '@brawltome/accounts/testing'
import { createTestDatabase, type TestDatabase } from '@brawltome/foundation/testing'
import postgres from 'postgres'
import { ActiveReplayJobError, type ReplayAnalysisJobs, replayAnalysisModule } from '../index'
import { createPostgresReplayAnalysisJobs } from '../postgres'

const accountId = randomUUID()
const replayDigest = `sha256:${'a'.repeat(64)}`
let database: TestDatabase | undefined
let control: ReturnType<typeof postgres>
let jobs: ReplayAnalysisJobs

beforeAll(async () => {
  database = await createTestDatabase({
    label: 'replay_analysis',
    modules: [...accountsTestModules, replayAnalysisModule],
  })

  control = postgres(database.connectionString, { max: 1 })
  await control`INSERT INTO accounts.users (id) VALUES (${accountId})`
  jobs = createPostgresReplayAnalysisJobs(database)
}, 20_000)

afterAll(async () => {
  await control?.end()
  await database?.drop()
}, 20_000)

describe('PostgreSQL replay analysis jobs', () => {
  test('fences stale claimants, keeps one active upload, and clears terminal replay bytes', async () => {
    const first = await jobs.create({
      accountId,
      replayBytes: Uint8Array.of(1, 2, 3),
      replayDigest,
      fileName: 'first.replay',
    })

    await expect(
      jobs.create({
        accountId,
        replayBytes: Uint8Array.of(4),
        replayDigest,
        fileName: 'blocked.replay',
      }),
    ).rejects.toBeInstanceOf(ActiveReplayJobError)

    const stale = await jobs.claim(60)

    expect(stale?.id).toBe(first.id)

    await control`
      UPDATE replay_analysis.jobs
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${first.id}
    `

    if (!stale) throw new Error('Expected the initial replay claim')

    expect(await jobs.complete(first.id, stale.leaseToken, replayDigest, { expired: true })).toBe('lease-lost')
    expect(await jobs.fail(first.id, stale.leaseToken, { code: 'expired', message: 'expired' })).toBe(false)
    expect(await jobs.renew(first.id, stale.leaseToken, 60)).toBe(false)
    expect(await jobs.release(first.id, stale.leaseToken)).toBe(false)
    const current = await jobs.claim(60)

    if (!current) throw new Error('Expected the replacement replay claim')

    expect(current.leaseToken).not.toBe(stale.leaseToken)
    expect(await jobs.renew(first.id, current.leaseToken, 60)).toBe(true)
    expect(await jobs.complete(first.id, stale.leaseToken, replayDigest, { stale: true })).toBe('lease-lost')
    expect(await jobs.fail(first.id, stale.leaseToken, { code: 'stale', message: 'stale' })).toBe(false)
    expect(await jobs.complete(first.id, current.leaseToken, `sha256:${'b'.repeat(64)}`, {})).toBe('digest-mismatch')
    expect(await jobs.complete(first.id, current.leaseToken, replayDigest, { accepted: true })).toBe('completed')

    const [terminal] = await control<{ replay_bytes: Uint8Array | null; status: string }[]>`
      SELECT replay_bytes, status FROM replay_analysis.jobs WHERE id = ${first.id}
    `

    expect(terminal).toEqual({ replay_bytes: null, status: 'completed' })

    const second = await jobs.create({
      accountId,
      replayBytes: Uint8Array.of(4, 5),
      replayDigest,
      fileName: 'second.replay',
    })

    const released = await jobs.claim(60)

    if (!released) throw new Error('Expected the second replay claim')

    expect(await jobs.release(second.id, randomUUID())).toBe(false)
    expect(await jobs.release(second.id, released.leaseToken)).toBe(true)
    const reclaimed = await jobs.claim(60)

    if (!reclaimed) throw new Error('Expected the released replay claim')

    expect(reclaimed.leaseToken).not.toBe(released.leaseToken)

    expect(
      await jobs.fail(second.id, reclaimed.leaseToken, { code: 'input.malformed', message: 'Invalid replay' }),
    ).toBe(true)
  })
})
