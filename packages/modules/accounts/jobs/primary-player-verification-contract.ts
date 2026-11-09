import { type JobContract, type ProofEffectPayload, parseProofEffectPayload } from '@brawltome/queue'

export const primaryPlayerVerificationContract: JobContract<ProofEffectPayload> = {
  kind: 'primary-player-verification',
  workClasses: ['interactive'],
  parsePayload: parseProofEffectPayload,
}
