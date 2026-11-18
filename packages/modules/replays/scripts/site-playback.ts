import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

// the site's tests play a 1v1 and a 2v2 back from the timelines this module trims; the other two fixture lines add
// nothing the stage reads, and each timeline is a few hundred kilobytes
export const sitePlaybackNames = ['duel-a', 'doubles-b'] as const

export type SitePlaybackName = (typeof sitePlaybackNames)[number]

const siteFixtures = resolve(import.meta.dir, '../../../../apps/site/tests/fixtures')
const lineFixtures = resolve(import.meta.dir, '../../match-insights/tests/fixtures')

/** Where the site's tests find the playback timeline of one of the fixture lines, gzipped. */
export function sitePlaybackPath(name: SitePlaybackName): string {
  return resolve(siteFixtures, `${name}.playback.json.gz`)
}

/** One of the anonymised lines the match-insights module's tests read. */
export function readFixtureLine(name: SitePlaybackName): unknown {
  const zipped = readFileSync(resolve(lineFixtures, `${name}.line.gz`))

  return JSON.parse(gunzipSync(zipped).toString('utf8'))
}
