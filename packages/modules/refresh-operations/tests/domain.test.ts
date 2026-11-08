import { describe, expect, test } from 'bun:test'
import { admissionConfigHash, chooseBackgroundClass, validateAdmissionConfig } from '../domain/admission'
import { decideExecutionFailure, decideSourceFailure } from '../domain/failure-decision'
import { JobLeaseLostError, SourceAdmissionLimitedError } from '../domain/job-errors'
import type { AdmissionConfig } from '../model'

const admission: AdmissionConfig = {
  totalConcurrency: 4,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 1,
    leaderboard: 2,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 1,
    leaderboard: 3,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
}

const retry = { retryDelayMs: 5_000, sourceUnavailableRetryMs: 90_000 }

describe('chooseBackgroundClass', () => {
  test('picks the class with the highest stored credit plus weight', () => {
    const credits = [
      { work_class: 'projection' as const, credit: '4' },
      { work_class: 'leaderboard' as const, credit: 0 },
    ]

    const { selected } = chooseBackgroundClass(['projection', 'leaderboard'], credits, admission)

    expect(selected).toBe('projection')
  })

  test('charges the winner the total weight of the eligible classes', () => {
    const { selected, nextCredits } = chooseBackgroundClass(['leaderboard', 'maintenance'], [], admission)

    expect(selected).toBe('leaderboard')
    expect(nextCredits.get('leaderboard')).toBe(3 - 4)
    expect(nextCredits.get('maintenance')).toBe(1)
  })

  test('keeps the first class when scores tie', () => {
    const { selected } = chooseBackgroundClass(['maintenance', 'projection'], [], admission)

    expect(selected).toBe('maintenance')
  })
})

describe('admissionConfigHash', () => {
  test('is the same for the same limits and changes when a weight does', () => {
    const changed = { ...admission, backgroundWeights: { ...admission.backgroundWeights, leaderboard: 4 } }

    expect(admissionConfigHash(admission).hash).toBe(admissionConfigHash({ ...admission }).hash)
    expect(admissionConfigHash(changed).hash).not.toBe(admissionConfigHash(admission).hash)
  })
})

describe('validateAdmissionConfig', () => {
  test('returns a valid config unchanged', () => {
    expect(validateAdmissionConfig(admission)).toBe(admission)
  })

  test('rejects an interactive class that cannot cover its reservation', () => {
    const invalid = { ...admission, classConcurrency: { ...admission.classConcurrency, interactive: 0 } }

    expect(() => validateAdmissionConfig(invalid)).toThrow('classConcurrency.interactive')
  })

  test('rejects a weight outside the allowed range', () => {
    const invalid = { ...admission, backgroundWeights: { ...admission.backgroundWeights, projection: 0 } }

    expect(() => validateAdmissionConfig(invalid)).toThrow('backgroundWeights.projection')
  })
})

describe('job errors', () => {
  test('a source admission limit carries the wait in seconds', () => {
    const error = new SourceAdmissionLimitedError(37)

    expect(error.retryAfterSeconds).toBe(37)
    expect(error).toBeInstanceOf(Error)
  })

  test('a lost job lease is an error of its own', () => {
    expect(new JobLeaseLostError('lost')).toBeInstanceOf(Error)
  })
})

describe('decideSourceFailure', () => {
  test('defers an admission limit for the wait it names', () => {
    const decision = decideSourceFailure(new SourceAdmissionLimitedError(37), retry)

    expect(decision).toEqual({
      action: 'defer',
      failure: { code: 'source_rate_limited', message: 'Source admission is rate limited', retryable: true },
      delayMs: 37_000,
      category: 'admission_deferred',
    })
  })

  test('defers a source outage and pauses the source for the same wait', () => {
    const outage = Object.assign(new Error('bad gateway'), { status: 502, domain: 'brawlhalla-v1' })

    const decision = decideSourceFailure(outage, retry)

    expect(decision).toEqual({
      action: 'defer',
      failure: { code: 'source_unavailable', message: 'bad gateway', retryable: true },
      delayMs: 90_000,
      category: 'source_unavailable',
      pauseSource: { domain: 'brawlhalla-v1', seconds: 90 },
    })
  })

  test('finds the outage anywhere in the cause chain', () => {
    const outage = { status: 503, domain: 'brawlhalla-v0' }
    const wrapped = new Error('wrapped', { cause: new Error('inner', { cause: outage }) })

    const decision = decideSourceFailure(wrapped, retry)

    expect(decision).toMatchObject({ action: 'defer', pauseSource: { domain: 'brawlhalla-v0' } })
  })

  test('waits at least a minute for an outage', () => {
    const outage = { status: 504, domain: 'brawlhalla-v1' }

    const decision = decideSourceFailure(outage, { retryDelayMs: 1_000, sourceUnavailableRetryMs: 5_000 })

    expect(decision).toMatchObject({ delayMs: 60_000, pauseSource: { seconds: 60 } })
  })

  test('returns null for an error that says nothing about the source', () => {
    expect(decideSourceFailure(new Error('boom'), retry)).toBeNull()
  })
})

describe('decideExecutionFailure', () => {
  test('fails with the kind failure code and the given delay', () => {
    const decision = decideExecutionFailure(new Error('boom'), 'clan_refresh_failed', 2_000)

    expect(decision).toEqual({
      action: 'fail',
      failure: { code: 'clan_refresh_failed', message: 'boom', retryable: true },
      delayMs: 2_000,
      category: 'execution',
    })
  })

  test('uses the retry-after of a rate limited source over the given delay', () => {
    const limited = Object.assign(new Error('slow down'), { retryAfterMs: 12_000 })

    const decision = decideExecutionFailure(limited, 'clan_refresh_failed', 2_000)

    expect(decision).toEqual({
      action: 'fail',
      failure: { code: 'source_rate_limited', message: 'slow down', retryable: true },
      delayMs: 12_000,
      category: 'source_rate_limited',
    })
  })

  test('keeps an error code and retryable false from the error itself', () => {
    const rejected = Object.assign(new Error('bad input'), { code: 'invalid_payload', retryable: false })

    const decision = decideExecutionFailure(rejected, 'proof_execution_failed', 2_000)

    expect(decision).toMatchObject({
      action: 'fail',
      failure: { code: 'invalid_payload', retryable: false },
      category: 'execution',
    })
  })

  test('describes a thrown non-object as an unknown failure', () => {
    const decision = decideExecutionFailure('nope', 'proof_execution_failed', 2_000)

    expect(decision).toMatchObject({
      failure: { code: 'proof_execution_failed', message: 'Unknown operation failure', retryable: true },
    })
  })
})
