import { describe, expect, test } from 'bun:test'
import { askForChallenge, type Challenge } from '../src/components/refresh/use-live-refresh'

describe('askForChallenge', () => {
  test('gives up when the challenge never answers', async () => {
    const shown: Array<Challenge | null> = []

    const token = await askForChallenge('site-key', (challenge) => shown.push(challenge), 10)

    expect(token).toBeNull()
    expect(shown.at(-1)).toBeNull()
  })

  test('passes on an answer that comes in time', async () => {
    const token = await askForChallenge('site-key', (challenge) => challenge?.settle('token'), 1_000)

    expect(token).toBe('token')
  })

  test('needs no challenge without a site key', async () => {
    expect(await askForChallenge(null, () => {}, 10)).toBeNull()
  })
})
