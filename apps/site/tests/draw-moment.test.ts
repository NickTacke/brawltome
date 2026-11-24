import { describe, expect, test } from 'bun:test'
import type { PlayerAssets, Replay, Timeline } from '@brawltome/replay-player'
import { drawMoment, type Framing } from '../src/components/match/stage/draw-moment'
import { readPlayback } from './match-fixtures'

// the stage holds its clock while drawMoment says the moment couldn't be drawn whole, so what it says for a player
// whose art never comes decides whether the match plays on

const timeline = readPlayback('duel-a') as Timeline
const [slot] = Object.keys(timeline.state)

// a player of the fixture's first slot whose art hasn't loaded: no frame of theirs can be drawn yet
function playerOf(missing?: Error): PlayerAssets {
  const player = {
    slot,
    animations: { frameCount: () => 1, frame: () => undefined },
    sets: new Map(),
    ready: new Map(),
  } as unknown as PlayerAssets

  if (missing) player.missing = missing

  return player
}

function replayOf(player: PlayerAssets): Replay {
  return { manifest: {}, players: new Map([[slot, player]]), groups: [] } as unknown as Replay
}

const canvas = {
  width: 160,
  height: 90,
  getContext: () => ({ clearRect() {}, save() {}, restore() {}, setTransform() {}, drawImage() {} }),
} as unknown as HTMLCanvasElement

// the whole level in view, so no player is drawn in a bubble
const framing: Framing = { transform: [1, 0, 0, 1, 0, 0], view: { x: -1e6, y: -1e6, width: 2e6, height: 2e6 } }

// a step the fixture's first player is on stage at
const step = timeline.startStep + 600

describe('drawing a moment', () => {
  test('is not whole while a player’s art is still loading, so the clock waits for it', () => {
    expect(drawMoment(canvas, { replay: replayOf(playerOf()), timeline }, step, framing, null)).toBe(false)
  })

  test('is whole without a missing player, whose art will never come, so the clock plays on', () => {
    const player = playerOf(new Error('load replay file sheets/0000000000000000.webp: HTTP 404'))

    expect(drawMoment(canvas, { replay: replayOf(player), timeline }, step, framing, null)).toBe(true)
  })
})
