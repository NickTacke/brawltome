import { resolve } from 'node:path'

const siteFixtures = resolve(import.meta.dir, '../../../../apps/site/tests/fixtures')

/** Where the site's tests find the insights of one of this module's fixtures. */
export function siteFixturePath(name: string): string {
  return resolve(siteFixtures, `${name}.insights.json`)
}
