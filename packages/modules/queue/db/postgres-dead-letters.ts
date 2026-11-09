import type { Database } from '@brawltome/foundation'
import type { DeadLetterOperations } from '../model'
import type { DeadLetterHooks } from './dead-letter-hooks'
import { disposeDeadLetter } from './dispose-dead-letter'
import { inspectDeadLetter } from './inspect-dead-letter'
import { listDeadLetters } from './list-dead-letters'

export function createPostgresDeadLetterOperations(database: Database, hooks: DeadLetterHooks): DeadLetterOperations {
  return {
    listDeadLetters: (input) => listDeadLetters(database, input),

    inspectDeadLetter: (operationId) => inspectDeadLetter(database, operationId, hooks),

    replayDeadLetter: (input) => disposeDeadLetter(database, { ...input, disposition: 'replayed' }, hooks),

    discardDeadLetter: (input) => disposeDeadLetter(database, { ...input, disposition: 'discarded' }, hooks),
  }
}
