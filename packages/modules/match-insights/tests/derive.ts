// the numbers the match page should show, worked out again straight from a line's raw events, state and the game's
// own counters. nothing here imports src/: a figure is only proven when two separate readings agree

export type RawEvent = {
  step: number
  type: string
  player?: number
  attacker?: number
  target?: number
  killer?: number | null
  damage?: number
  weapon?: string
  move?: string
  signature?: boolean
  kind?: string
  direction?: string
}

type Series = [number, unknown][]

type RawPlayer = { slot: number; team: number; name: string }

export type RawLine = {
  stats: Record<string, Record<string, unknown>> & { GameDuration: number }
  match: { rules: { hasTeams: boolean; stocks: number }; players: RawPlayer[] }
  timeline: {
    stepMs: number
    startStep: number
    endStep: number
    events: RawEvent[]
    state: Record<string, Record<string, Series>>
  }
}

export function asRawLine(line: unknown): RawLine {
  return line as RawLine
}

/** The last value a change list took at or before a step. */
export function valueAt<Value>(series: Series, step: number, fallback: Value): Value {
  let value = fallback

  for (const [at, current] of series) {
    if (at > step) break

    value = current as Value
  }

  return value
}

export function msOf(line: RawLine, step: number): number {
  return Math.max(0, (step - line.timeline.startStep) * line.timeline.stepMs)
}

export function stepAt(line: RawLine, timeMs: number): number {
  return line.timeline.startStep + Math.floor(timeMs / line.timeline.stepMs)
}

export function stateSeries(line: RawLine, slot: number, name: string): Series {
  return line.timeline.state[String(slot)]?.[name] ?? []
}

export function statsOf(line: RawLine, slot: number): Record<string, unknown> {
  return line.stats[`Player${slot}`] ?? {}
}

export function sideOf(line: RawLine, slot: number): number {
  const player = line.match.players.find((entry) => entry.slot === slot)

  return line.match.rules.hasTeams ? (player?.team ?? slot) : slot
}

export function areEnemies(line: RawLine, left: number, right: number): boolean {
  return left !== right && sideOf(line, left) !== sideOf(line, right)
}

export function eventsOf(line: RawLine, type: string): RawEvent[] {
  return line.timeline.events.filter((event) => event.type === type)
}

export function fallsOf(line: RawLine, slot: number): RawEvent[] {
  return eventsOf(line, 'ko').filter((event) => event.player === slot)
}

export function enemyKos(line: RawLine, slot: number): number {
  const kos = eventsOf(line, 'ko').filter((event) => event.killer === slot)

  return kos.filter((event) => areEnemies(line, slot, event.player as number)).length
}

export function enemyHits(line: RawLine, attacker: number): RawEvent[] {
  return eventsOf(line, 'hit').filter((hit) => hit.attacker === attacker && areEnemies(line, attacker, hit.target ?? 0))
}

export function sumDamage(events: RawEvent[]): number {
  return events.reduce((total, event) => total + (event.damage ?? 0), 0)
}

/** The sides that fell least: the winners. */
export function winningSides(line: RawLine): Set<number> {
  const falls = new Map<number, number>()

  for (const player of line.match.players) {
    const side = sideOf(line, player.slot)

    falls.set(side, (falls.get(side) ?? 0) + fallsOf(line, player.slot).length)
  }

  const fewest = Math.min(...falls.values())

  return new Set([...falls].filter(([, count]) => count === fewest).map(([side]) => side))
}
