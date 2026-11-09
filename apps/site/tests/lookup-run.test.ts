import { describe, expect, test } from 'bun:test'
import { type LookupStatus, runLookup } from '../src/components/lookup/lookup-run'
import type { RefreshAnswer } from '../src/components/refresh/refresh-answer'

type FakeOptions = {
  answers: RefreshAnswer[]
  challengeToken?: string | null
  foundAfterLoads?: number
}

// answers come in order, the last one repeats; time only moves when the run waits
function fakeLookup({ answers, challengeToken = 'token', foundAfterLoads = 1 }: FakeOptions) {
  const statuses: LookupStatus[] = []
  const tokens: (string | undefined)[] = []
  const waitsMs: number[] = []
  let loads = 0

  const run = {
    request: async (turnstileToken?: string) => {
      tokens.push(turnstileToken)

      return answers[Math.min(tokens.length - 1, answers.length - 1)]
    },
    solveChallenge: async () => challengeToken,
    reload: async () => {
      loads += 1
    },
    isRefreshed: () => loads >= foundAfterLoads,
    wait: async (milliseconds: number) => {
      waitsMs.push(milliseconds)
    },
    isCancelled: () => false,
    setStatus: (status: LookupStatus) => statuses.push(status),
  }

  return { run, statuses, tokens, waitsMs, loads: () => loads }
}

const refreshing: RefreshAnswer = { kind: 'refreshing', pollAfterSeconds: 2 }
const neverFound = Number.POSITIVE_INFINITY

describe('runLookup', () => {
  test('an unknown player is looked up and found', async () => {
    const fake = fakeLookup({ answers: [refreshing], foundAfterLoads: 2 })

    await runLookup(fake.run)

    expect(fake.statuses).toEqual(['looking', 'found'])
    expect(fake.loads()).toBe(2)
  })

  test('a player stored meanwhile is loaded once', async () => {
    const fake = fakeLookup({ answers: [{ kind: 'fresh' }] })

    await runLookup(fake.run)

    expect(fake.statuses).toEqual(['looking', 'found'])
    expect(fake.loads()).toBe(1)
  })

  test('the challenge answer is sent with the next request', async () => {
    const fake = fakeLookup({ answers: [{ kind: 'verify', siteKey: 'site-key' }, refreshing] })

    await runLookup(fake.run)

    expect(fake.tokens).toEqual([undefined, 'token'])
    expect(fake.statuses).toEqual(['looking', 'found'])
  })

  // brawlhalla answers nothing for an id it doesn't know, so the lookup only learns it by never finding the player
  test('a player that never turns up is missing after the longest wait', async () => {
    const fake = fakeLookup({ answers: [refreshing], foundAfterLoads: neverFound })

    await runLookup(fake.run)

    const waitedMs = fake.waitsMs.reduce((total, waitMs) => total + waitMs, 0)

    expect(fake.statuses).toEqual(['looking', 'missing'])
    expect(waitedMs).toBeGreaterThanOrEqual(90_000)
  })

  test('a player the api calls fresh but no read finds is missing', async () => {
    const fake = fakeLookup({ answers: [{ kind: 'fresh' }], foundAfterLoads: neverFound })

    await runLookup(fake.run)

    expect(fake.statuses).toEqual(['looking', 'missing'])
  })

  test('an admission refusal with a long wait is refused at once', async () => {
    const fake = fakeLookup({ answers: [{ kind: 'refused', retryAfterSeconds: 900 }] })

    await runLookup(fake.run)

    expect(fake.tokens).toHaveLength(1)
    expect(fake.loads()).toBe(0)
    expect(fake.statuses).toEqual(['looking', 'refused'])
  })

  test('an unanswered challenge cannot look up', async () => {
    const fake = fakeLookup({ answers: [{ kind: 'verify', siteKey: null }], challengeToken: null })

    await runLookup(fake.run)

    expect(fake.statuses).toEqual(['looking', 'unverified'])
  })

  test('an api that stays busy fails the lookup', async () => {
    const fake = fakeLookup({ answers: [{ kind: 'unavailable', retryAfterSeconds: 30 }] })

    await runLookup(fake.run)

    expect(fake.tokens).toHaveLength(3)
    expect(fake.statuses).toEqual(['looking', 'failed'])
  })

  test('a request that throws fails the lookup, and trying again finds the player', async () => {
    const fake = fakeLookup({ answers: [refreshing] })
    const failing = { ...fake.run, request: () => Promise.reject(new Error('network down')) }

    await runLookup(failing)
    await runLookup(fake.run)

    expect(fake.statuses).toEqual(['looking', 'failed', 'looking', 'found'])
  })

  test('a cancelled lookup stops without a final status', async () => {
    const fake = fakeLookup({ answers: [refreshing], foundAfterLoads: neverFound })
    let isCancelled = false

    // the visitor leaves while the lookup waits for the first look
    const leaveWhileWaiting = async () => {
      isCancelled = true
    }

    await runLookup({ ...fake.run, wait: leaveWhileWaiting, isCancelled: () => isCancelled })

    expect(fake.statuses).toEqual(['looking'])
    expect(fake.loads()).toBe(0)
  })
})
