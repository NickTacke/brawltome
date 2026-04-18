import type { EntityInputs, InputEvent } from '@brawltome/replay-format'

// Given one entity's recorded input events (sparse; recorded only on change),
// produce the active bitmask at an arbitrary tick-time in ms. Cursor-advance
// pattern so repeated calls at monotonically increasing times stay O(1)
// amortized.
export class InputCursor {
  private index = 0
  private current = 0

  constructor(private readonly events: readonly InputEvent[]) {}

  // Returns the input bitmask that was active at or just before `timestampMs`.
  advanceTo(timestampMs: number): number {
    while (this.index < this.events.length && this.events[this.index].timestampMs <= timestampMs) {
      this.current = this.events[this.index].inputFlags
      this.index++
    }
    return this.current
  }

  reset(): void {
    this.index = 0
    this.current = 0
  }
}

export class InputDriver {
  private readonly cursors = new Map<number, InputCursor>()

  constructor(inputs: readonly EntityInputs[]) {
    for (const entry of inputs) {
      this.cursors.set(entry.entityId, new InputCursor(entry.inputs))
    }
  }

  flagsAt(entityId: number, timestampMs: number): number {
    const c = this.cursors.get(entityId)
    return c === undefined ? 0 : c.advanceTo(timestampMs)
  }

  reset(): void {
    for (const c of this.cursors.values()) c.reset()
  }
}
