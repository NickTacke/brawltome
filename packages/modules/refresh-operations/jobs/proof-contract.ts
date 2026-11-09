import { readPayloadObject } from '../domain/payload-fields'
import { workClasses } from '../model'
import type { ProofEffectPayload } from './complete-with-proof-effect'
import type { JobContract } from './job-definition'

export function parseProofEffectPayload(value: unknown): ProofEffectPayload {
  const payload = readPayloadObject(value, 'proof')

  if (typeof payload.value !== 'string') throw new Error('proof value must be a string')

  return value as ProofEffectPayload
}

// nothing writes this kind any more; old rows and replays of them still run
export const proofContract: JobContract<ProofEffectPayload> = {
  kind: 'proof',
  workClasses,
  parsePayload: parseProofEffectPayload,
}
