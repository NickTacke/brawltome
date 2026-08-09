export type ParityStatus = 'planned' | 'implemented' | 'verified' | 'waived'
export type ParityArea = 'shell-navigation' | 'placeholder' | 'preserved-public-route' | 'refresh-admission'
export type EvidenceKind = 'unit' | 'integration' | 'browser' | 'manual' | 'external'

export type ParityEvidence = {
  kind: EvidenceKind
  path: string
  assertion: string
}

export type ParityWaiver = {
  owner: string
  reason: string
  expires: string
}

export type ParityRow = {
  id: string
  area: ParityArea
  requirement: string
  sourceIssue: `#${number}`
  status: ParityStatus
  destinations: string[]
  implementation: string[]
  evidence: ParityEvidence[]
  verificationGap?: string
  blocker?: string
  waiver?: ParityWaiver
}
