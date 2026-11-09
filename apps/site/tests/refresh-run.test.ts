import { describe, expect, test } from 'bun:test'
import type { RefreshAnswer } from '../src/components/refresh/refresh-answer'
import { type RefreshStatus, runRefresh } from '../src/components/refresh/refresh-run'

type FakeOptions = {
  answers: RefreshAnswer[]
  challengeToken?: string | null
  refreshedAfterReloads?: number
  failingReloads?: boolean
}

// answers come in order, the last one repeats; time only moves when the run waits
function fakeRun({ answers, challengeToken = 'token', refreshedAfterReloads = 1, failingReloads }: FakeOptions) {
  const statuses: RefreshStatus[] = []
  const tokens: (string | undefined)[] = []
  const waitsMs: number[] = []
  let reloads = 0

  const run = {
    request: async (turnstileToken?: string) => {
      tokens.push(turnstileToken)

      return answers[Math.min(tokens.length - 1, answers.length - 1)]
    },
    solveChallenge: async () => challengeToken,
    reload: async () => {
      reloads += 1

      if (failingReloads) throw new Error('load player 7: the player could not be read')
    },
    isRefreshed: () => reloads >= refreshedAfterReloads,
    wait: async (milliseconds: number) => {
      waitsMs.push(milliseconds)
    },
    isCancelled: () => false,
    setStatus: (status: RefreshStatus) => statuses.push(status),
  }

  return { run, statuses, tokens, waitsMs, reloads: () => reloads }
}

const refreshing: RefreshAnswer = { kind: 'refreshing', pollAfterSeconds: 2 }

describe('runRefresh', () => {
  test('a stale page shows the update, then the fresh data', async () => {
    const fake = fakeRun({ answers: [refreshing], refreshedAfterReloads: 2 })

    await runRefresh(fake.run)

    expect(fake.statuses).toEqual(['updating', 'idle'])
    expect(fake.waitsMs).toEqual([2_000, 3_000])
    expect(fake.reloads()).toBe(2)
  })

  test('data that turned fresh meanwhile is loaded once', async () => {
    const fake = fakeRun({ answers: [{ kind: 'fresh' }] })

    await runRefresh(fake.run)

    expect(fake.statuses).toEqual(['updating', 'idle'])
    expect(fake.reloads()).toBe(1)
  })

  // another visitor may finish the refresh first, the page still has to show the new data before it stops trying
  test('fresh data that fails to load ends in a failure', async () => {
    const { run, statuses } = fakeRun({ answers: [{ kind: 'fresh' }], failingReloads: true })

    await runRefresh(run)

    expect(statuses).toEqual(['updating', 'failed'])
  })

  test('the challenge answer is sent with the next request', async () => {
    const fake = fakeRun({ answers: [{ kind: 'verify', siteKey: 'site-key' }, refreshing] })

    await runRefresh(fake.run)

    expect(fake.tokens).toEqual([undefined, 'token'])
    expect(fake.statuses).toEqual(['updating', 'idle'])
  })

  test('an unanswered challenge cannot update', async () => {
    const fake = fakeRun({ answers: [{ kind: 'verify', siteKey: null }], challengeToken: null })

    await runRefresh(fake.run)

    expect(fake.tokens).toEqual([undefined])
    expect(fake.statuses).toEqual(['updating', 'failed'])
  })

  test('an admission refusal with a long wait gives up at once', async () => {
    const fake = fakeRun({ answers: [{ kind: 'refused', retryAfterSeconds: 900 }] })

    await runRefresh(fake.run)

    expect(fake.tokens).toHaveLength(1)
    expect(fake.statuses).toEqual(['updating', 'failed'])
  })

  test('a short refusal is tried twice more after the wait it names', async () => {
    const fake = fakeRun({ answers: [{ kind: 'refused', retryAfterSeconds: 10 }] })

    await runRefresh(fake.run)

    expect(fake.tokens).toHaveLength(3)
    expect(fake.waitsMs).toEqual([10_000, 10_000])
    expect(fake.statuses).toEqual(['updating', 'failed'])
  })

  test('a busy api is tried again and the refresh still lands', async () => {
    const fake = fakeRun({ answers: [{ kind: 'unavailable', retryAfterSeconds: 30 }, refreshing] })

    await runRefresh(fake.run)

    expect(fake.statuses).toEqual(['updating', 'idle'])
  })

  test('a request that throws counts as an unavailable api', async () => {
    const fake = fakeRun({ answers: [refreshing] })
    const failing = { ...fake.run, request: () => Promise.reject(new Error('network down')) }

    await runRefresh(failing)

    expect(fake.statuses).toEqual(['updating', 'failed'])
  })

  test('failed reloads keep the page and end in a failure after the longest wait', async () => {
    const fake = fakeRun({
      answers: [refreshing],
      failingReloads: true,
      refreshedAfterReloads: Number.POSITIVE_INFINITY,
    })

    await runRefresh(fake.run)

    const waitedMs = fake.waitsMs.reduce((total, waitMs) => total + waitMs, 0)

    expect(fake.statuses).toEqual(['updating', 'failed'])
    expect(waitedMs).toBeGreaterThanOrEqual(90_000)
    expect(fake.waitsMs.length).toBeLessThan(20)
  })

  test('a cancelled run stops without a final status', async () => {
    const fake = fakeRun({ answers: [refreshing], refreshedAfterReloads: Number.POSITIVE_INFINITY })
    let isCancelled = false

    // the visitor leaves while the run waits for the first look
    const leaveWhileWaiting = async () => {
      isCancelled = true
    }

    const cancelling = { ...fake.run, wait: leaveWhileWaiting, isCancelled: () => isCancelled }

    await runRefresh(cancelling)

    expect(fake.statuses).toEqual(['updating'])
    expect(fake.reloads()).toBe(0)
  })
})
