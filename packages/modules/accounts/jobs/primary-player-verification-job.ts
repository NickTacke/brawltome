import {
  completeWithProofEffect,
  defineJob,
  type JobDefinition,
  type Lease,
  type ProofEffectPayload,
} from '@brawltome/refresh-operations'
import { proofEffectState } from '../db/proof-effects'
import type { Accounts } from '../src/accounts'
import { primaryPlayerVerificationContract } from './primary-player-verification-contract'

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
    ...primaryPlayerVerificationContract,
    // the code this work reported as a proof, so dashboards read the same before and after
    failureCode: 'proof_execution_failed',
    effectState: proofEffectState,
    async run(lease, tools) {
      await accounts.resolvePrimaryPlayerVerification(lease.payload.value, createEvidenceResolver(lease))

      return completeWithProofEffect(lease, tools)
    },
  })
}
