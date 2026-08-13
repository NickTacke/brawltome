import { describe, expect, mock, test } from 'bun:test'
import { createObservedR2Put } from '../src/matchmaking-telemetry'

describe('matchmaking R2 telemetry', () => {
  test('observes uploads without passing keys, bytes, URLs, or options to telemetry', async () => {
    const put = mock(async () => undefined)
    const r2 = { put }
    const observerArguments: unknown[][] = []
    const observedPut = createObservedR2Put(r2, async (...args) => {
      observerArguments.push(args)
      return args[1]()
    })
    const bytes = new Uint8Array([1, 2, 3])

    await observedPut('private/replay-key', bytes, { contentType: 'application/octet-stream' })

    expect(put).toHaveBeenCalledWith('private/replay-key', bytes, { contentType: 'application/octet-stream' })
    expect(observerArguments).toHaveLength(1)
    expect(observerArguments[0]).toHaveLength(2)
    expect(observerArguments[0]?.[0]).toBe('r2')
    expect(typeof observerArguments[0]?.[1]).toBe('function')
    expect(JSON.stringify(observerArguments)).not.toContain('private/replay-key')
    expect(JSON.stringify(observerArguments)).not.toContain('application/octet-stream')
  })
})
