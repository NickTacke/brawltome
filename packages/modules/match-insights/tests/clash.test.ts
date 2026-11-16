import { describe, expect, test } from 'bun:test'
import { readMatchInsights } from '../index'
import { type RawEvent, type RawLine, valueAt } from './derive'
import { swingsOf, thrownHits } from './derive-swings'
import { readFixtureLine } from './fixtures'

// doubles-b has two players clash on one step, each in a swing. the game names no weapon for a clash, so with the
// clashing player's swings taken out of the line, nothing tells what they hit with but the weapon they held

type EditableLine = { timeline: { events: RawEvent[]; state: Record<string, Record<string, [number, unknown][]>> } }

const clashStep = 996
const clashing = 1

function lineWithoutSwings(): EditableLine {
  const line = readFixtureLine('doubles-b') as EditableLine

  line.timeline.events = line.timeline.events.filter(
    (event) => !(event.type === 'attack' && event.player === clashing && event.step <= clashStep),
  )

  return line
}

describe('a clash with no swing open', () => {
  const line = lineWithoutSwings()
  const insights = readMatchInsights(line, null)
  const held = valueAt<string>(line.timeline.state[String(clashing)]?.weapon ?? [], clashStep, '')

  const punish = insights?.insights.punishes.find(
    (entry) => entry.attacker === clashing && entry.startStep <= clashStep && clashStep <= entry.endStep,
  )

  test('is a clash with the weapon held, not a weapon throw', () => {
    expect(punish?.cause).not.toBe('throw')
    expect(punish?.hits[0]).toMatchObject({ weapon: held, move: 'Clash' })
  })

  test('counts as neither a throw that landed nor a swing', () => {
    const raw = line as unknown as RawLine
    const oddities = insights?.insights.players.find((player) => player.slot === clashing)?.oddities
    const throws = new Set(thrownHits(raw, clashing).map((hit) => `${hit.step} ${hit.weapon}`))

    expect(oddities?.throwsHit).toBe(throws.size)
    expect(oddities?.swings).toBe(swingsOf(raw, clashing).length)
  })
})
