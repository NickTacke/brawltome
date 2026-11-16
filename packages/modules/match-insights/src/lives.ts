import { type MatchRecord, stateOf, toMs } from './record'

// one entry per life a player had: from going live until the next KO or the end of the match

export type Life = {
  startMs: number
  endMs: number
  // [ms, damage taken so far in this life]
  damage: [number, number][]
  isKo: boolean
}

type Span = { fromStep: number; toStep: number; isKo: boolean }

// the last stock ends in 'eliminated' instead of 'ko'
function lifeSpans(record: MatchRecord, slot: number): Span[] {
  const spans: Span[] = []
  let fromStep: number | null = null

  for (const [step, status] of stateOf(record, slot).status) {
    if (status === 'live' && fromStep === null) fromStep = step

    if ((status === 'ko' || status === 'eliminated') && fromStep !== null) {
      spans.push({ fromStep, toStep: step, isKo: true })
      fromStep = null
    }
  }

  if (fromStep !== null) spans.push({ fromStep, toStep: record.endStep, isKo: false })

  return spans
}

// the game zeroes the damage on the KO's own step, so the life's last change comes before it
function lifeOf(record: MatchRecord, slot: number, span: Span): Life {
  const inside = stateOf(record, slot).damage.filter(([step]) => step >= span.fromStep && step < span.toStep)
  const startMs = toMs(record, span.fromStep)
  const endMs = Math.min(record.durationMs, toMs(record, span.toStep))
  const changes = inside.map(([step, damage]): [number, number] => [toMs(record, step), damage])
  const last = changes.at(-1)?.[1] ?? 0

  return { startMs, endMs, damage: [[startMs, 0], ...changes, [endMs, last]], isKo: span.isKo }
}

export function readLives(record: MatchRecord, slot: number): Life[] {
  return lifeSpans(record, slot).map((span) => lifeOf(record, slot, span))
}
