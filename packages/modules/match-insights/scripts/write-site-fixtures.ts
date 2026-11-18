import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { readMatchInsights } from '../index'
import { fixtureNames, readFixtureLine } from '../tests/fixtures'
import { siteFixturePath } from './site-fixtures'

// writes the insights of every fixture line where the site's tests read them, as the site can't import this module

for (const name of fixtureNames) {
  const insights = readMatchInsights(readFixtureLine(name), null)

  if (!insights) throw new Error(`write site fixture ${name}: the line has no insights`)

  const path = siteFixturePath(name)

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(insights)}\n`)
  console.log(`wrote ${path}`)
}
