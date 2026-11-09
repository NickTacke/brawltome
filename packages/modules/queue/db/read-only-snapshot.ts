// every read in the transaction sees the same snapshot, so results read together agree with each other; it takes
// no locks, so it never waits on a writer
export const readOnlySnapshot = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const
