import type { AttemptOutcome, JobTools, Lease } from './job-definition'

export type ProofEffectPayload = { value: string }

/** Records the effect of a proof-style operation and settles the lease on what the write found. */
export async function completeWithProofEffect(
  lease: Lease<ProofEffectPayload>,
  tools: Pick<JobTools, 'queue'>,
): Promise<AttemptOutcome> {
  const effect = await tools.queue.commitProofEffect(lease)

  if (effect === 'lease-lost') return 'lease_lost'

  if (effect === 'effect-conflict') {
    const transition = await tools.queue.fail(
      lease,
      { code: 'effect_conflict', message: 'Operation key belongs to a different effect', retryable: false },
      0,
    )

    return transition === 'lease-lost' ? 'lease_lost' : 'dead_letter'
  }

  const transition = await tools.queue.complete(lease)

  return transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
}
