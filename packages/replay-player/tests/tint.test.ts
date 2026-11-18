import { expect, test } from 'bun:test'
import { type Timeline, tintAt } from '..'
import { tintKey } from '../src/tint.ts'

type PlayerState = Timeline['state'][string]

// a line of one player whose clock starts at 0 and moves 16 ms a step
function lineWith(
  state: Omit<PlayerState, 'animation'>,
  options: { hasClock: boolean } = { hasClock: true },
): Timeline {
  return {
    stepMs: 16,
    startStep: 0,
    endStep: 1000,
    animations: [],
    state: { '1': { animation: [], ...state } },
    stepZeroTime: options.hasClock ? 0 : undefined,
    positions: { every: 4 },
  }
}

const tintKeyAt = (timeline: Timeline, step: number) => tintKey(tintAt(timeline, 1, step))

test('tintAt follows the hit flash and respawn blink rules', () => {
  // after a respawn: white plus 666666 in the first 100 ms of every 300, nothing between
  const respawned = lineWith({ afterRespawn: [[0, true]], invulnerable: [[0, true]], lastHit: [[0, 0]] })

  expect(tintKeyAt(respawned, 0)).toBe('ffffff/666666')
  expect(tintKeyAt(respawned, 6)).toBe('ffffff/666666')
  expect(tintKeyAt(respawned, 7)).toBe('-')
  expect(tintKeyAt(respawned, 19)).toBe('ffffff/666666')

  // can't be hit: white plus 333333, ahead of a hit flash
  const invulnerable = lineWith({ invulnerable: [[0, true]], lastHit: [[0, 0]] })

  expect(tintKeyAt(invulnerable, 3)).toBe('ffffff/333333')

  // a hit flashes for 175 ms, its own step included (11 steps), in the damage's colour now
  const hit = lineWith({
    lastHit: [[100, 100]],
    damage: [
      [0, 0],
      [105, 75],
      [108, 300],
    ],
    airJumpsUsed: [[0, 2]],
  })

  expect(tintKeyAt(hit, 100)).toBe('555555/aaaaaa')
  expect(tintKeyAt(hit, 105)).toBe('555555/aa8800')
  expect(tintKeyAt(hit, 110)).toBe('555555/310000')
  expect(tintKeyAt(hit, 111)).toBe('bbbbbb/111111')

  // both air jumps used darkens; one doesn't
  const jumped = lineWith({ airJumpsUsed: [[0, 1]] })

  expect(tintKeyAt(jumped, 50)).toBe('-')
  expect(tintKeyAt(lineWith({ airJumpsUsed: [[0, 2]] }), 50)).toBe('bbbbbb/111111')

  // a line that doesn't record the clock has no tints
  expect(tintAt(lineWith({ airJumpsUsed: [[0, 2]] }, { hasClock: false }), 1, 50)).toBeUndefined()
})
