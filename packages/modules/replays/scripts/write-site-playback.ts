import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { trimPlaybackTimeline } from '../playback'
import { readFixtureLine, sitePlaybackNames, sitePlaybackPath } from './site-playback'

// writes the playback timelines of the fixture lines where the site's tests read them, as the site can't import
// this module

for (const name of sitePlaybackNames) {
  const timeline = trimPlaybackTimeline(readFixtureLine(name))
  const path = sitePlaybackPath(name)

  writeFileSync(path, gzipSync(JSON.stringify(timeline), { level: 9 }))
  console.log(`wrote ${path}`)
}
