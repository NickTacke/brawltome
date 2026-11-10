import { beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const siteRoot = join(import.meta.dir, '..')
const outputRoot = join(siteRoot, 'dist')
const clientOutput = join(outputRoot, 'client')
const serverOutput = join(outputRoot, 'server')
// the session token only travels between the site's server and the api, so nothing in the browser names it
const secretMarkers = ['INTERNAL_API_SECRET', 'x-internal-secret', 'x-visitor-session', 'brawltome_session']
const buildTimeoutMs = 180_000
const largestClientScriptBytes = 500_000
// an entry type only the web vitals library asks the browser for
const webVitalsMarker = 'largest-contentful-paint'
// an event only the site's own client entry listens for
const errorReportingMarker = 'unhandledrejection'

function outputFiles(root: string): string[] {
  const entries = readdirSync(root, { recursive: true, encoding: 'utf8' })

  return entries.map((entry) => join(root, entry)).filter((path) => statSync(path).isFile())
}

function filesContaining(root: string, marker: string): string[] {
  const containsMarker = (path: string) => readFileSync(path).includes(marker)

  return outputFiles(root)
    .filter(containsMarker)
    .map((path) => relative(root, path))
}

// always a fresh build, old output could hide a leak added since
function buildSite(): void {
  rmSync(outputRoot, { recursive: true, force: true })

  const build = Bun.spawnSync([process.execPath, 'run', 'build'], {
    cwd: siteRoot,
    // bun test sets NODE_ENV=test, which would check a development bundle
    env: { ...process.env, NODE_ENV: 'production' },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (build.exitCode !== 0) throw new Error(`build the site for the bundle check: ${build.stderr.toString()}`)
}

describe('client bundle', () => {
  beforeAll(buildSite, buildTimeoutMs)

  test('the build writes javascript for the browser', () => {
    const scripts = outputFiles(clientOutput).filter((path) => path.endsWith('.js'))

    expect(scripts.length).toBeGreaterThan(0)
  })

  // the game data package holds megabytes of frame data, one wrong import ships it to every visitor
  test('no client script is oversized', () => {
    const scripts = outputFiles(clientOutput).filter((path) => path.endsWith('.js'))
    const oversized = scripts.filter((path) => statSync(path).size > largestClientScriptBytes)

    expect(oversized.map((path) => relative(clientOutput, path))).toEqual([])
  })

  // measuring loading speed must not add to what a page downloads before it is usable
  test('the web vitals library is a script of its own, fetched only when asked for', () => {
    const withLibrary = filesContaining(clientOutput, webVitalsMarker)

    expect(withLibrary).toHaveLength(1)
    expect(withLibrary[0]).toMatch(/^assets\/web-vitals-[\w-]+\.js$/)
  })

  // errors are reported from src/client.tsx, which replaces the framework's entry only as long as the build finds it
  test('the client entry that reports errors is the one that was built', () => {
    expect(filesContaining(clientOutput, errorReportingMarker)).toHaveLength(1)
  })

  // without this the check below passes on a site where nothing uses the api client
  test.each(['x-internal-secret', 'x-visitor-session', 'brawltome_session'])('%s is in the server output', (marker) => {
    expect(filesContaining(serverOutput, marker).length).toBeGreaterThan(0)
  })

  test.each(secretMarkers)('no client file contains %s', (marker) => {
    expect(filesContaining(clientOutput, marker)).toEqual([])
  })
})
