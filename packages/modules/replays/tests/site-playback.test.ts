import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { trimPlaybackTimeline } from '../playback'
import { readFixtureLine, sitePlaybackNames, sitePlaybackPath } from '../scripts/site-playback'

// the site can't import this module, so its tests read timelines trimmed from the same lines; this fails when those
// files no longer match what this module serves. `bun run write-site-playback` here writes them again
describe('site playback fixtures', () => {
  test.each(sitePlaybackNames)('%s matches the timeline trimmed from its line now', (name) => {
    const written: unknown = JSON.parse(gunzipSync(readFileSync(sitePlaybackPath(name))).toString('utf8'))
    const current: unknown = JSON.parse(JSON.stringify(trimPlaybackTimeline(readFixtureLine(name))))

    expect(written).toEqual(current)
  })
})
