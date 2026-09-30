export type EventlineKind = 'dodge' | 'move' | 'hit' | 'ko'

export type EventlineEvent = {
  readonly id: string
  readonly timestampMs: number
  readonly sequence: number
  readonly kind: EventlineKind
  readonly actor: string
  readonly target?: string
  readonly detail: string
  readonly damage?: number
}

export const demoEventline = [
  {
    id: 'dodge-0',
    timestampMs: 6_032,
    sequence: 0,
    kind: 'dodge',
    actor: 'AxeMender',
    detail: 'Right ground dodge accepted',
  },
  {
    id: 'move-1',
    timestampMs: 6_048,
    sequence: 1,
    kind: 'move',
    actor: 'AxeMender',
    detail: 'Sword · nLight accepted',
  },
  {
    id: 'hit-2',
    timestampMs: 6_080,
    sequence: 2,
    kind: 'hit',
    actor: 'AxeMender',
    target: 'BlueMammoth',
    detail: 'Enemy hit resolved',
    damage: 13.5,
  },
  {
    id: 'ko-3',
    timestampMs: 30_000,
    sequence: 3,
    kind: 'ko',
    actor: 'AxeMender',
    target: 'BlueMammoth',
    detail: 'Knockout confirmed',
  },
] as const satisfies readonly EventlineEvent[]

export function orderEventline(events: readonly EventlineEvent[]): EventlineEvent[] {
  return [...events].sort((left, right) => left.timestampMs - right.timestampMs || left.sequence - right.sequence)
}

export function formatEventlineTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}
