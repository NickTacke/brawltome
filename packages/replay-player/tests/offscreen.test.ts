import { describe, expect, test } from 'bun:test'
import { bubbleMatrix, bubblesAt, OFFSCREEN, type OffscreenPlayer, offscreenPlayersAt, type Timeline } from '..'

// a view of 2400 by 1350 units with its corner at the origin
const view = { x: 0, y: 0, width: 2400, height: 1350 }
const live = (x: number, y: number): OffscreenPlayer => ({ slot: '1', x, y, isLive: true })

describe('bubblesAt', () => {
  test('draws nothing for a player in view, edges included', () => {
    expect(bubblesAt(view, [live(1200, 600), live(0, 0), live(2400, 1350)])).toEqual([])
  })

  test('holds a player past the right edge 210 units inside it, following them up and down', () => {
    const [bubble] = bubblesAt(view, [live(2401, 900)])

    expect(bubble?.x).toBe(2400 - 210)
    expect(bubble?.y).toBe(900 - 80)
    expect(bubble?.player).toEqual({ x: 2190, y: 900 })
    expect(bubble?.angle).toBe(0)
    expect(bubble?.radius).toBe(165)
    expect(bubble?.zoom).toBe(1)
    expect(bubble?.alpha).toBe(1)
  })

  test('goes by the feet: a player whose feet are below the bottom gets a bubble with their body still in view', () => {
    const [bubble] = bubblesAt(view, [live(600, 1400)])

    expect(bubble?.y).toBe(1350 - 210)
    expect(bubble?.player).toEqual({ x: 600, y: 1350 - 210 + 80 })
    expect(bubble?.angle).toBe(90)
  })

  test('holds both axes in a corner and points the arrow into it', () => {
    const [bubble] = bubblesAt(view, [live(-500, -900)])

    expect(bubble?.x).toBe(210)
    expect(bubble?.y).toBe(210)
    expect(bubble?.angle).toBe(225)
  })

  test.each([
    [3000, 600, 0],
    [3000, 2000, 45],
    [1200, 2000, 90],
    [-100, 2000, 135],
    [-100, 600, 180],
    [-100, -100, 225],
    [1200, -100, 270],
    [3000, -100, 315],
  ])('points in eight steps, one for each side and corner: %d, %d points at %d', (x, y, angle) => {
    expect(bubblesAt(view, [live(x, y)])[0]?.angle).toBe(angle)
  })

  test('draws none for a player not in play: respawning, held or knocked out a while ago', () => {
    const out: OffscreenPlayer = { slot: '1', x: 3000, y: 600, isLive: false }

    expect(bubblesAt(view, [out])).toEqual([])
    expect(bubblesAt(view, [{ ...out, msSinceKo: OFFSCREEN.fadeMs }])).toEqual([])
  })

  test("fades a knocked out player's bubble over 146 ms, sliding it out through the side", () => {
    const knockedOut: OffscreenPlayer = { slot: '1', x: 3000, y: 2000, isLive: false, msSinceKo: 73 }
    const [bubble] = bubblesAt(view, [knockedOut])

    expect(bubble?.alpha).toBe(0.5)
    expect(bubble?.x).toBe(2190 + 315)
    expect(bubble?.y).toBe(1140 + 315)
    expect(bubblesAt(view, [{ ...knockedOut, msSinceKo: 0 }])[0]?.alpha).toBe(1)
  })

  test("gives each player out of view a bubble of their own, in the players' order, overlapping where they meet", () => {
    const bubbles = bubblesAt(view, [
      { ...live(3000, 600), slot: '2' },
      { ...live(1200, 600), slot: '3' },
      { ...live(3100, 610), slot: '4' },
    ])

    expect(bubbles.map((bubble) => [bubble.slot, bubble.x, bubble.y])).toEqual([
      ['2', 2190, 520],
      ['4', 2190, 530],
    ])
  })

  test('draws nothing over an empty view', () => {
    expect(bubblesAt({ x: 0, y: 0, width: 0, height: 0 }, [live(5, 5)])).toEqual([])
  })
})

describe('offscreenPlayersAt', () => {
  const timeline = {
    stepMs: 16,
    startStep: 0,
    endStep: 200,
    animations: [],
    positions: { every: 4, '1': { from: 0, x: [0, 40, 80], y: [0, 0, 0] } },
    state: {
      '1': {
        animation: [],
        status: [
          [0, 'live'],
          [100, 'ko'],
          [150, 'respawning'],
        ],
      },
    },
  } as unknown as Timeline

  test('reads the position between samples and the status at the step', () => {
    expect(offscreenPlayersAt(timeline, 2)).toEqual([{ slot: '1', x: 20, y: 0, isLive: true, msSinceKo: undefined }])
  })

  test('times the fade from the step the player was knocked out', () => {
    const [player] = offscreenPlayersAt(timeline, 104.5)

    expect(player?.isLive).toBe(false)
    expect(player?.msSinceKo).toBe(64)
  })

  test('forgets the KO once the player starts respawning', () => {
    expect(offscreenPlayersAt(timeline, 160)[0]?.msSinceKo).toBeUndefined()
  })
})

describe('bubbleMatrix', () => {
  test("turns the art clockwise to the arrow's angle about the bubble's middle", () => {
    const [bubble] = bubblesAt(view, [live(1200, 2000)])

    if (!bubble) throw new Error('expected a bubble below the view')

    const [a, b, c, d, x, y] = bubbleMatrix(bubble)

    // the art's arrow points along +x; at 90 degrees it points down the screen
    expect(Math.abs(a)).toBeLessThan(1e-12)
    expect(Math.abs(d)).toBeLessThan(1e-12)
    expect(b).toBe(1)
    expect(c).toBe(-1)
    expect([x, y]).toEqual([1200, 1140])
  })
})
