export const REQUIRED_WINDOWS_CHECKS = [
  'gameProcessDetected',
  'processAttached',
  'detectionReady',
  'rankedOpponentDetected',
  'processDetached',
  'overlayVisible',
  'overlayAlwaysOnTop',
  'clickThroughEnabled',
  'clickThroughDisabled',
  'trayHidden',
  'trayShown',
  'trayQuit',
  'apiFailurePresented',
  'appSurvivedApiFailure',
  'updaterSignatureVerified',
  'updaterInstalled',
  'updaterRelaunched',
  'updaterVersionReplaced',
] as const

export type WindowsAcceptanceCheck = (typeof REQUIRED_WINDOWS_CHECKS)[number]

export type AcceptanceMode = 'ranked1v1' | 'ranked2v2' | 'ranked3v3'

export type WindowsAcceptancePolicy = {
  windowsRelease: string
  hardware: string
  workloadId: string
  minimumSamples: number
  requiredModeSamples: Record<AcceptanceMode, number>
  maximumP95Ms: number
}

export type WindowsAcceptanceEvidence = {
  schema: 1
  status: 'pending' | 'observed'
  observedAt?: string | null
  platform?: {
    productName: string
    displayVersion: string
    build: number
    productType: number
    hardware: string
  } | null
  workload?: {
    id: string | null
    samples: Array<{
      id: string
      durationMs: number
      outcome: 'opponent-rendered'
      mode: AcceptanceMode
    }>
  }
  checks?: Partial<Record<WindowsAcceptanceCheck, boolean>>
  claims?: {
    windows11: false
    hardware: false
    updaterInstall: false
    performance: false
  }
}

type AcceptanceClaims = {
  windows11: boolean
  hardware: boolean
  updaterInstall: boolean
  performance: boolean
}

export type WindowsAcceptanceResult = {
  status: 'pending' | 'failed' | 'passed'
  claims: AcceptanceClaims
  failures: string[]
  pending: string[]
  performance: {
    sampleCount: number
    p95Ms: number | null
    method: 'nearest-rank'
  }
}

function validatePolicy(policy: WindowsAcceptancePolicy): void {
  if (!policy.windowsRelease.trim()) throw new Error('windowsRelease must not be empty')
  if (!policy.hardware.trim()) throw new Error('hardware must not be empty')
  if (!policy.workloadId.trim()) throw new Error('workloadId must not be empty')
  if (!Number.isInteger(policy.minimumSamples) || policy.minimumSamples <= 0) {
    throw new Error('minimumSamples must be a positive integer')
  }
  const requiredModeCounts = Object.values(policy.requiredModeSamples)
  if (requiredModeCounts.some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error('requiredModeSamples must contain non-negative integers')
  }
  if (requiredModeCounts.reduce((total, count) => total + count, 0) < policy.minimumSamples) {
    throw new Error('requiredModeSamples must cover minimumSamples')
  }
  if (policy.maximumP95Ms !== 2_000) throw new Error('maximumP95Ms must be 2000 for #217')
}

export function nearestRankPercentile(samples: readonly number[], percentile: number): number | null {
  if (samples.length === 0) return null
  if (!(percentile > 0 && percentile <= 1)) throw new Error('percentile must be greater than zero and at most one')
  const ordered = [...samples].sort((left, right) => left - right)
  return ordered[Math.ceil(percentile * ordered.length) - 1]
}

type Findings = { failures: string[]; pending: string[] }
type PerformanceResult = WindowsAcceptanceResult['performance']

function validateEvidenceHeader(evidence: WindowsAcceptanceEvidence, findings: Findings): void {
  if (evidence.schema !== 1) findings.failures.push('unsupported Windows acceptance evidence schema')
  if (evidence.status === 'pending') findings.pending.push('supported Windows 11 observation')
  if (evidence.status !== 'observed') return

  const observedAt = evidence.observedAt ? Date.parse(evidence.observedAt) : Number.NaN
  if (!Number.isFinite(observedAt)) findings.failures.push('observedAt must be an ISO-8601 timestamp')
}

function validatePlatform(
  platform: WindowsAcceptanceEvidence['platform'],
  policy: WindowsAcceptancePolicy,
  findings: Findings,
): void {
  if (!platform) {
    if (!findings.pending.includes('supported Windows 11 observation')) {
      findings.pending.push('supported Windows 11 observation')
    }
    return
  }
  if (!platform.productName.includes('Windows 11') || platform.productType !== 1) {
    findings.failures.push('platform must be a Windows 11 workstation')
  }
  if (platform.displayVersion !== policy.windowsRelease) {
    findings.failures.push(`Windows 11 release must be ${policy.windowsRelease}`)
  }
  if (!Number.isInteger(platform.build) || platform.build <= 0) {
    findings.failures.push('Windows build must be a positive integer')
  }
  if (platform.hardware !== policy.hardware) {
    findings.failures.push(`hardware must be ${policy.hardware}`)
  }
}

function evaluateWorkload(
  workload: WindowsAcceptanceEvidence['workload'],
  policy: WindowsAcceptancePolicy,
  findings: Findings,
): PerformanceResult {
  const samples = workload?.samples ?? []
  if (!workload?.id) findings.pending.push('owner-approved acceptance workload')
  else if (workload.id !== policy.workloadId) findings.failures.push(`workload must be ${policy.workloadId}`)

  if (new Set(samples.map((sample) => sample.id)).size !== samples.length) {
    findings.failures.push('performance sample IDs must be unique')
  }
  const invalidSample = samples.some(
    (sample) => !sample.id.trim() || !Number.isFinite(sample.durationMs) || sample.durationMs < 0,
  )
  if (invalidSample) findings.failures.push('performance sample durations must be finite non-negative milliseconds')
  if (samples.length < policy.minimumSamples) {
    findings.pending.push(`at least ${policy.minimumSamples} completed opponent-render samples`)
  }
  for (const [mode, required] of Object.entries(policy.requiredModeSamples) as Array<[AcceptanceMode, number]>) {
    const observed = samples.filter((sample) => sample.mode === mode).length
    if (observed < required) findings.pending.push(`at least ${required} ${mode} samples`)
  }

  const p95Ms = nearestRankPercentile(
    samples.map((sample) => sample.durationMs),
    0.95,
  )
  if (samples.length >= policy.minimumSamples && p95Ms !== null && p95Ms >= policy.maximumP95Ms) {
    findings.failures.push(`opponent presentation p95 must be below ${policy.maximumP95Ms} ms`)
  }
  return { sampleCount: samples.length, p95Ms, method: 'nearest-rank' }
}

function validateChecks(checks: WindowsAcceptanceEvidence['checks'], findings: Findings): void {
  for (const check of REQUIRED_WINDOWS_CHECKS) {
    if (checks?.[check] === false) findings.failures.push(`${check} did not pass`)
    else if (checks?.[check] !== true) findings.pending.push(check)
  }
}

function resultStatus(findings: Findings): WindowsAcceptanceResult['status'] {
  if (findings.failures.length > 0) return 'failed'
  if (findings.pending.length > 0) return 'pending'
  return 'passed'
}

export function evaluateWindowsAcceptance(
  evidence: WindowsAcceptanceEvidence,
  policy: WindowsAcceptancePolicy,
): WindowsAcceptanceResult {
  validatePolicy(policy)
  const findings: Findings = { failures: [], pending: [] }
  validateEvidenceHeader(evidence, findings)
  validatePlatform(evidence.platform, policy, findings)
  const performance = evaluateWorkload(evidence.workload, policy, findings)
  validateChecks(evidence.checks, findings)

  const status = resultStatus(findings)
  const accepted = status === 'passed'
  return {
    status,
    claims: {
      windows11: accepted,
      hardware: accepted,
      updaterInstall: accepted,
      performance: accepted,
    },
    ...findings,
    performance,
  }
}

if (import.meta.main) {
  const [evidencePath, policyPath] = process.argv.slice(2)
  if (!evidencePath || !policyPath) {
    process.stderr.write('usage: bun run src/windows-acceptance.ts <evidence.json> <policy.json>\n')
    process.exitCode = 1
  } else {
    try {
      const [evidence, policy] = await Promise.all([
        Bun.file(evidencePath).json() as Promise<WindowsAcceptanceEvidence>,
        Bun.file(policyPath).json() as Promise<WindowsAcceptancePolicy>,
      ])
      const result = evaluateWindowsAcceptance(evidence, policy)
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      if (result.status !== 'passed') process.exitCode = 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Windows acceptance evaluation failed'
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    }
  }
}
