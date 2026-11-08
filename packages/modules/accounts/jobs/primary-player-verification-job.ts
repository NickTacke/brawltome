import {
  completeWithProofEffect,
  defineJob,
  type JobDefinition,
  type Lease,
  type ProofEffectPayload,
  proofEffectState,
} from '@brawltome/refresh-operations'
import type { Accounts } from '../src/accounts'

type PrimaryPlayerEvidenceResolver = Parameters<Accounts['resolvePrimaryPlayerVerification']>[1]

export type PrimaryPlayerVerificationJobDependencies = {
  accounts: Pick<Accounts, 'resolvePrimaryPlayerVerification'>
  // the Steam resolver, with every Brawlhalla call admitted under this lease
  createEvidenceResolver(lease: Lease<ProofEffectPayload>): PrimaryPlayerEvidenceResolver
}

export function createPrimaryPlayerVerificationJob(
  dependencies: PrimaryPlayerVerificationJobDependencies,
): JobDefinition<ProofEffectPayload> {
  const { accounts, createEvidenceResolver } = dependencies

  return defineJob<ProofEffectPayload>({
    kind: 'primary-player-verification',
    workClasses: ['interactive'],
    // the code this work reported as a proof, so dashboards read the same before and after
    failureCode: 'proof_execution_failed',
    // claim already shapes this payload
    parsePayload: (value) => value as ProofEffectPayload,
    effectState: proofEffectState,
    async run(lease, tools) {
      await accounts.resolvePrimaryPlayerVerification(lease.payload.value, createEvidenceResolver(lease))

      return completeWithProofEffect(lease, tools)
    },
  })
}
