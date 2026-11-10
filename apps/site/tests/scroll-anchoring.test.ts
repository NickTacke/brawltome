import { describe, expect, test } from 'bun:test'
import { pauseScrollAnchoring } from '../src/components/scroll-anchoring'

function fakeRoot() {
  return { style: { overflowAnchor: '' } }
}

function wait(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

describe('pauseScrollAnchoring', () => {
  test('turns scroll anchoring off until the panel has finished animating', async () => {
    const root = fakeRoot()

    pauseScrollAnchoring(root, 20)

    expect(root.style.overflowAnchor).toBe('none')

    await wait(40)

    expect(root.style.overflowAnchor).toBe('')
  })

  test('a second toggle during the animation keeps anchoring off until it ends too', async () => {
    const root = fakeRoot()

    pauseScrollAnchoring(root, 40)
    await wait(25)
    pauseScrollAnchoring(root, 40)
    await wait(25)

    expect(root.style.overflowAnchor).toBe('none')

    await wait(30)

    expect(root.style.overflowAnchor).toBe('')
  })
})
