import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

// a real anonymised ranked 1v1, shared with the match-insights module's tests

type Line = {
  stats: Record<string, unknown>
  match: { rules: { mode: { id: number; name: string } } }
  timeline: Record<string, unknown>
}

const fixtureFolder = resolve(import.meta.dir, '../../../match-insights/tests/fixtures')

function readLine(): Line {
  const line = JSON.parse(gunzipSync(readFileSync(resolve(fixtureFolder, 'duel-a.line.gz'))).toString('utf8')) as Line

  // the line's stats dump has no Score, which storing a match reads
  for (const slot of ['Player1', 'Player2']) line.stats[slot] = { Score: 0, ...(line.stats[slot] as object) }

  return line
}

/** The line as text, the way the worker sends it. */
export function insightLine(): string {
  return JSON.stringify(readLine())
}

/** The same 1v1, played as a timed match, which the match page wasn't designed for. */
export function timedLine(): string {
  const line = readLine()

  line.match.rules.mode = { id: 1, name: 'Time' }

  return JSON.stringify(line)
}

/** The same 1v1 with its players' state missing, so its insights can't be worked out. */
export function brokenLine(): string {
  const line = readLine()

  delete line.timeline.state

  return JSON.stringify(line)
}
