import { describe, expect, test } from 'bun:test'
import { renderAcknowledgement } from '@/acceptance'
import {
  type WindowsAcceptanceCheck,
  type WindowsAcceptanceEvidence,
  type WindowsAcceptancePolicy,
  evaluateWindowsAcceptance,
} from '../src/windows-acceptance'

const policy: WindowsAcceptancePolicy = {
  windowsRelease: '24H2',
  hardware: 'owner-designated-test-host',
  workloadId: 'owner-approved-ranked-workload-v1',
  minimumSamples: 20,
  requiredModeSamples: { ranked1v1: 20, ranked2v2: 0, ranked3v3: 0 },
  maximumP95Ms: 2_000,
}

const requiredChecks: Record<WindowsAcceptanceCheck, boolean> = {
  gameProcessDetected: true,
  processAttached: true,
  detectionReady: true,
  rankedOpponentDetected: true,
  processDetached: true,
  overlayVisible: true,
  overlayAlwaysOnTop: true,
  clickThroughEnabled: true,
  clickThroughDisabled: true,
  trayHidden: true,
  trayShown: true,
  trayQuit: true,
  apiFailurePresented: true,
  appSurvivedApiFailure: true,
  updaterSignatureVerified: true,
  updaterInstalled: true,
  updaterRelaunched: true,
  updaterVersionReplaced: true,
}

type CompleteEvidence = WindowsAcceptanceEvidence & {
  platform: NonNullable<WindowsAcceptanceEvidence['platform']>
  workload: NonNullable<WindowsAcceptanceEvidence['workload']>
  checks: Record<WindowsAcceptanceCheck, boolean>
}

function completeEvidence(durations = Array.from({ length: 20 }, (_, index) => 1_000 + index * 50)): CompleteEvidence {
  return {
    schema: 1,
    status: 'observed',
    observedAt: '2026-08-10T20:00:00.000Z',
    platform: {
      productName: 'Microsoft Windows 11 Pro',
      displayVersion: '24H2',
      build: 26_100,
      productType: 1,
      hardware: 'owner-designated-test-host',
    },
    workload: {
      id: policy.workloadId,
      samples: durations.map((durationMs, index) => ({
        id: `sample-${index + 1}`,
        durationMs,
        outcome: 'opponent-rendered' as const,
        mode: 'ranked1v1' as const,
      })),
    },
    checks: { ...requiredChecks },
  }
}

describe('desktop render acknowledgement', () => {
  test('acknowledges only rendered opponents and classifies safe API failure presentation', () => {
    expect(renderAcknowledgement(null, [])).toBeNull()
    expect(renderAcknowledgement('sample-1', [])).toBeNull()
    expect(renderAcknowledgement('sample-1', [{ refreshState: 'idle' }])).toEqual({
      sampleId: 'sample-1',
      apiFailurePresented: false,
    })
    expect(renderAcknowledgement('sample-2', [{ refreshState: 'apiFailure' }])).toEqual({
      sampleId: 'sample-2',
      apiFailurePresented: true,
    })
  })
})

describe('Windows 11 desktop acceptance evidence', () => {
  test('keeps the committed template pending and claim-free', async () => {
    const evidence = (await Bun.file(
      `${import.meta.dir}/../smoke/windows-11.pending.json`,
    ).json()) as WindowsAcceptanceEvidence

    const result = evaluateWindowsAcceptance(evidence, policy)

    expect(result.status).toBe('pending')
    expect(result.claims).toEqual({
      windows11: false,
      hardware: false,
      updaterInstall: false,
      performance: false,
    })
    expect(result.pending).toContain('supported Windows 11 observation')
  })

  test('accepts complete evidence only when nearest-rank p95 is strictly below two seconds', () => {
    const result = evaluateWindowsAcceptance(completeEvidence(), policy)

    expect(result.status).toBe('passed')
    expect(result.performance).toEqual({ sampleCount: 20, p95Ms: 1_900, method: 'nearest-rank' })
    expect(result.claims).toEqual({ windows11: true, hardware: true, updaterInstall: true, performance: true })
  })

  test('rejects p95 equal to or above the strict two-second threshold', () => {
    const equalDurations = [...Array.from({ length: 18 }, () => 1_000), 2_000, 2_500]
    const aboveDurations = [...Array.from({ length: 18 }, () => 1_000), 2_001, 2_500]

    for (const durations of [equalDurations, aboveDurations]) {
      const result = evaluateWindowsAcceptance(completeEvidence(durations), policy)
      expect(result.status).toBe('failed')
      expect(result.claims.performance).toBe(false)
      expect(result.failures).toContain(`opponent presentation p95 must be below ${policy.maximumP95Ms} ms`)
    }
  })

  test('rejects duplicate, invalid, and insufficient performance samples', () => {
    const duplicate = completeEvidence()
    duplicate.workload.samples[1].id = duplicate.workload.samples[0].id
    expect(evaluateWindowsAcceptance(duplicate, policy).failures).toContain('performance sample IDs must be unique')

    const invalid = completeEvidence()
    invalid.workload.samples[0].durationMs = -1
    expect(evaluateWindowsAcceptance(invalid, policy).failures).toContain(
      'performance sample durations must be finite non-negative milliseconds',
    )

    const insufficient = completeEvidence().workload.samples.slice(0, 19)
    const result = evaluateWindowsAcceptance(
      { ...completeEvidence(), workload: { id: policy.workloadId, samples: insufficient } },
      policy,
    )
    expect(result.status).toBe('pending')
    expect(result.pending).toContain('at least 20 completed opponent-render samples')
  })

  test('enforces the exact owner-approved mode mix', () => {
    const mixedPolicy: WindowsAcceptancePolicy = {
      ...policy,
      requiredModeSamples: { ranked1v1: 10, ranked2v2: 10, ranked3v3: 0 },
    }

    const result = evaluateWindowsAcceptance(completeEvidence(), mixedPolicy)

    expect(result.status).toBe('pending')
    expect(result.pending).toContain('at least 10 ranked2v2 samples')
    expect(result.claims.performance).toBe(false)
  })

  test('does not accept Windows Server, Windows 10, a different release, or different hardware', () => {
    const unsupportedPlatforms: Array<NonNullable<WindowsAcceptanceEvidence['platform']>> = [
      { ...completeEvidence().platform, productName: 'Microsoft Windows Server 2025 Datacenter', productType: 3 },
      { ...completeEvidence().platform, productName: 'Microsoft Windows 10 Pro' },
      { ...completeEvidence().platform, displayVersion: '23H2' },
      { ...completeEvidence().platform, hardware: 'unapproved-hardware' },
    ]

    for (const platform of unsupportedPlatforms) {
      const result = evaluateWindowsAcceptance({ ...completeEvidence(), platform }, policy)
      expect(result.status).toBe('failed')
      expect(result.claims.windows11).toBe(false)
    }
  })

  test('fails closed when a required lifecycle, API failure, or updater check fails', () => {
    for (const check of ['processDetached', 'appSurvivedApiFailure', 'updaterVersionReplaced'] as const) {
      const evidence = completeEvidence()
      evidence.checks[check] = false
      const result = evaluateWindowsAcceptance(evidence, policy)
      expect(result.status).toBe('failed')
      expect(result.failures).toContain(`${check} did not pass`)
      expect(Object.values(result.claims).every((claim) => !claim)).toBe(true)
    }
  })

  test('requires an explicit valid acceptance policy', () => {
    expect(() => evaluateWindowsAcceptance(completeEvidence(), { ...policy, windowsRelease: '' })).toThrow(
      'windowsRelease must not be empty',
    )
    expect(() => evaluateWindowsAcceptance(completeEvidence(), { ...policy, hardware: '' })).toThrow(
      'hardware must not be empty',
    )
    expect(() => evaluateWindowsAcceptance(completeEvidence(), { ...policy, minimumSamples: 0 })).toThrow(
      'minimumSamples must be a positive integer',
    )
    expect(() =>
      evaluateWindowsAcceptance(completeEvidence(), {
        ...policy,
        requiredModeSamples: { ranked1v1: 19, ranked2v2: 0, ranked3v3: 0 },
      }),
    ).toThrow('requiredModeSamples must cover minimumSamples')
    expect(() => evaluateWindowsAcceptance(completeEvidence(), { ...policy, maximumP95Ms: 2_001 })).toThrow(
      'maximumP95Ms must be 2000 for #217',
    )
  })
})
