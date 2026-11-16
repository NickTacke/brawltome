import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

// four anonymised ranked matches, as bh-native printed them: two 1v1s and two 2v2s
export const fixtureNames = ['duel-a', 'duel-b', 'doubles-a', 'doubles-b'] as const

export type FixtureName = (typeof fixtureNames)[number]

export function readFixtureLine(name: FixtureName): unknown {
  const zipped = readFileSync(resolve(import.meta.dir, 'fixtures', `${name}.line.gz`))

  return JSON.parse(gunzipSync(zipped).toString('utf8'))
}
