import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { cachedRead } from '../src/server/cached-read'

const freshMs = 60_000
const retryMs = 5_000

function counter() {
  let count = 0

  return mock(async () => {
    count += 1

    return count
  })
}

function failing() {
  return mock(async (): Promise<number> => {
    throw new Error('cms is down')
  })
}

describe('cachedRead', () => {
  beforeEach(() => {
    spyOn(console, 'error').mockImplementation(() => undefined)
  })

  test('reads once while the copy is fresh', async () => {
    const read = counter()
    const load = cachedRead(read, { freshMs, retryMs })

    expect(await load(0)).toBe(1)
    expect(await load(freshMs - 1)).toBe(1)
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('reads again once the copy is old', async () => {
    const load = cachedRead(counter(), { freshMs, retryMs })

    await load(0)

    expect(await load(freshMs)).toBe(2)
  })

  test('callers at the same moment share one read', async () => {
    const read = counter()
    const load = cachedRead(read, { freshMs, retryMs })

    await Promise.all([load(0), load(0)])

    expect(read).toHaveBeenCalledTimes(1)
  })

  test('a failure with nothing cached is null', async () => {
    const load = cachedRead(failing(), { freshMs, retryMs })

    expect(await load(0)).toBeNull()
  })

  test('a failure keeps serving the last good copy', async () => {
    let isDown = false

    const read = mock(async () => {
      if (isDown) throw new Error('cms is down')

      return 'patches'
    })

    const load = cachedRead(read, { freshMs, retryMs })

    await load(0)
    isDown = true

    expect(await load(freshMs)).toBe('patches')
  })

  test('waits before trying a failed source again', async () => {
    const read = failing()
    const load = cachedRead(read, { freshMs, retryMs })

    await load(0)
    await load(retryMs - 1)

    expect(read).toHaveBeenCalledTimes(1)

    await load(retryMs)

    expect(read).toHaveBeenCalledTimes(2)
  })
})
