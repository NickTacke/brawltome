import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { readMatchInsights } from '../index'
import { siteFixturePath } from '../scripts/site-fixtures'
import { fixtureNames, readFixtureLine } from './fixtures'

// the site can't import this module, so its tests read insights written out from the same lines; this fails when
// those files no longer match what this module reads. `bun run write-site-fixtures` here writes them again
describe('site fixtures', () => {
  test.each(fixtureNames)('%s matches what the line reads as now', (name) => {
    const written: unknown = JSON.parse(readFileSync(siteFixturePath(name), 'utf8'))
    const current: unknown = JSON.parse(JSON.stringify(readMatchInsights(readFixtureLine(name), null)))

    expect(written).toEqual(current)
  })
})
