import { describe, expect, test } from 'bun:test'
import { eventsOf, type RawEvent, sideOf } from './derive'
import { switchesOff } from './derive-state'
import { thrownHits } from './derive-swings'
import { fixtures } from './insights'

// every lead names an event or state change of the target the line records, inside the window its kind allows

const leadWindowsMs: Record<string, number> = {
  swing: 1440,
  whiff: 1440,
  dodge: 480,
  landing: 128,
  free: 480,
  trade: 160,
}

const movementWords: Record<string, string> = { jump: 'jumped', dash: 'dashed', throw: 'threw a weapon' }

function dodgeWords(direction: string): string {
  return direction === '' ? 'on the spot' : direction.replace('-', ' and ')
}

describe.each(fixtures())('how the openings of $name began', (fixture) => {
  const { line } = fixture
  const { punishes, moments } = fixture.insights.insights
  const events = line.timeline.events
  const stepMs = line.timeline.stepMs

  const openings = moments.flatMap((moment) => {
    const punish = punishes[Number(moment.key.replace('punish-', ''))]

    return moment.lead && moment.key.startsWith('punish-') && punish ? [{ lead: moment.lead, punish }] : []
  })

  test('every lead points at an event or state change of the target, inside its window', () => {
    for (const { lead, punish } of openings) {
      const step = punish.startStep - (lead.beforeMs ?? 0) / stepMs
      const own = events.filter((event) => event.step === step && event.player === punish.target)

      if (lead.beforeMs !== null) expect(lead.beforeMs).toBeLessThanOrEqual(leadWindowsMs[lead.kind] as number)

      if (lead.kind === 'dodge') {
        const dodge = own.find((event) => event.type === 'dodge') as { direction?: string } | undefined

        expect(dodgeWords(dodge?.direction ?? 'missing')).toBe(lead.action as string)
      }

      if (lead.kind === 'swing' || lead.kind === 'whiff')
        expect(own.some((event) => event.type === 'attack')).toBe(true)

      if (lead.kind === 'landing') expect(switchesOff(line, punish.target, 'inAir')).toContain(step)

      if (lead.kind === 'free' && lead.action !== null) {
        expect(own.some((event) => movementWords[event.type] === lead.action)).toBe(true)
      }
    }
  })

  test('a thrown lead starts on something thrown, a trade on a hit back', () => {
    for (const { lead, punish } of openings) {
      const hitsBack = eventsOf(line, 'hit').filter(
        (hit) =>
          hit.attacker === punish.target &&
          hit.target === punish.attacker &&
          Math.abs(hit.step - punish.startStep) <= 10,
      )

      const first = eventsOf(line, 'hit').find(
        (hit) => hit.step === punish.startStep && hit.attacker === punish.attacker && hit.target === punish.target,
      )

      if (lead.kind === 'throw') expect(thrownHits(line, punish.attacker)).toContain(first as RawEvent)

      if (lead.kind === 'trade') expect(hitsBack.length).toBeGreaterThan(0)
    }
  })

  test("the attacker's own swing started when the lead says", () => {
    for (const { lead, punish } of openings) {
      if (lead.attackBeforeMs === null) continue

      const step = punish.startStep - lead.attackBeforeMs / stepMs

      expect(
        events.some((event) => event.type === 'attack' && event.player === punish.attacker && event.step === step),
      ).toBe(true)
    }
  })
})

describe.each(fixtures())('knockouts of $name', (fixture) => {
  test("name the weapon of the killer's last hit on the victim", () => {
    const hits = eventsOf(fixture.line, 'hit')

    for (const [index, ko] of eventsOf(fixture.line, 'ko').entries()) {
      const knockout = fixture.insights.insights.knockouts[index]
      const last = hits.findLast((hit) => hit.attacker === ko.killer && hit.target === ko.player && hit.step <= ko.step)

      const weapon = last
        ? String(last.weapon)
            .replace(/^Throw/, '')
            .replace(/^Lance$/, 'RocketLance')
        : null

      if (!knockout?.isByTeammate) expect(knockout?.weapon ?? null).toBe(weapon)
    }
  })

  test('count the lead changing hands from the KO order', () => {
    const falls = new Map<number, number>()
    let leader: number | null = null
    let changes = 0

    for (const ko of eventsOf(fixture.line, 'ko')) {
      const side = sideOf(fixture.line, ko.player as number)

      falls.set(side, (falls.get(side) ?? 0) + 1)

      const counts = [...new Set(fixture.line.match.players.map((player) => sideOf(fixture.line, player.slot)))].map(
        (other): [number, number] => [other, falls.get(other) ?? 0],
      )

      const fewest = Math.min(...counts.map(([, count]) => count))
      const ahead = counts.filter(([, count]) => count === fewest)

      if (ahead.length !== 1) continue

      if (leader !== null && leader !== ahead[0]?.[0]) changes += 1

      leader = ahead[0]?.[0] ?? null
    }

    expect(fixture.insights.insights.leadChanges).toBe(changes)
  })
})
