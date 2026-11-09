import type { DeadLetterDisposition, DeadLetterDispositionInput, DeadLetterDispositionResult } from '../model'

export function validateDispositionInput(input: DeadLetterDispositionInput) {
  const actorId = input.actorId.trim()
  const reason = input.reason.trim()

  if ([...actorId].length < 1 || [...actorId].length > 200) {
    throw new Error('actorId must contain between 1 and 200 characters')
  }

  if ([...reason].length < 1 || [...reason].length > 500) {
    throw new Error('reason must contain between 1 and 500 characters')
  }

  return { actorId, reason }
}

export function toDispositionResult(action: {
  id: string
  disposition: DeadLetterDisposition
  replayOperationId: string | null
}): DeadLetterDispositionResult {
  if (action.disposition === 'replayed' && action.replayOperationId) {
    return {
      outcome: 'already-disposed',
      disposition: 'replayed',
      actionId: action.id,
      replayOperationId: action.replayOperationId,
    }
  }

  return {
    outcome: 'already-disposed',
    disposition: 'discarded',
    actionId: action.id,
    replayOperationId: null,
  }
}
