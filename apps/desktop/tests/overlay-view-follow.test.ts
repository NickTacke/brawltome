import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { OverlayView } from '../ui/overlay/overlay-view'
import type { OverlayEnvelope } from '../ui/overlay/useOverlayView'

type Listener = (event: { payload: unknown }) => void

const calls: string[] = []
const listeners = new Map<string, Listener>()
let answerCurrentView: (envelope: OverlayEnvelope | null) => void = () => {}

mock.module('@tauri-apps/api/event', () => ({
  listen: async (name: string, listener: Listener) => {
    calls.push(`listen ${name}`)
    listeners.set(name, listener)

    return () => {
      calls.push(`unlisten ${name}`)
      listeners.delete(name)
    }
  },
}))

mock.module('@tauri-apps/api/core', () => ({
  invoke: (command: string) => {
    calls.push(`invoke ${command}`)

    return new Promise((resolve) => {
      answerCurrentView = resolve
    })
  },
}))

const { followTheApp } = await import('../ui/overlay/useOverlayView')

function envelope(name: string): OverlayEnvelope {
  const file = path.join(import.meta.dir, 'fixtures', `overlay-view-${name}.json`)
  const view: OverlayView = JSON.parse(readFileSync(file, 'utf8'))

  return { view, monitorHeightPx: 1080 }
}

// lets the awaited listen calls and the invoke resolve
async function settle() {
  for (let step = 0; step < 5; step += 1) await Promise.resolve()
}

function follow() {
  const shown: (OverlayEnvelope | null)[] = []
  const stop = followTheApp((next) => shown.push(next))

  return { shown, stop }
}

describe('following the app', () => {
  beforeEach(() => {
    calls.length = 0
    listeners.clear()
  })

  test('listens before it asks for the current view', async () => {
    follow()
    await settle()

    expect(calls).toEqual(['listen overlay://view', 'listen overlay://clear', 'invoke get_overlay_view'])
  })

  test('takes the current view when nothing came in meanwhile', async () => {
    const { shown } = follow()

    await settle()

    answerCurrentView(envelope('solo-loading'))
    await settle()

    expect(shown).toEqual([envelope('solo-loading')])
  })

  test('a view that comes in while it asks wins over the older answer', async () => {
    const { shown } = follow()

    await settle()

    listeners.get('overlay://view')?.({ payload: envelope('solo-ranked') })
    answerCurrentView(envelope('solo-loading'))
    await settle()

    expect(shown).toEqual([envelope('solo-ranked')])
  })

  test('a clear leaves nothing to draw', async () => {
    const { shown } = follow()

    await settle()

    listeners.get('overlay://view')?.({ payload: envelope('solo-ranked') })
    listeners.get('overlay://clear')?.({ payload: null })

    expect(shown).toEqual([envelope('solo-ranked'), null])
  })

  test('stops listening when the page lets go', async () => {
    const { stop } = follow()

    await settle()

    stop()

    expect(listeners.size).toBe(0)
  })
})
