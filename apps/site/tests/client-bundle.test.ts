import { beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const siteRoot = join(import.meta.dir, '..')
const outputRoot = join(siteRoot, 'dist')
const clientOutput = join(outputRoot, 'client')
const serverOutput = join(outputRoot, 'server')
const secretMarkers = ['INTERNAL_API_SECRET', 'x-internal-secret']
const buildTimeoutMs = 180_000

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

  // without this the check below passes on a site where nothing uses the api client
  test('the secret header is in the server output', () => {
    expect(filesContaining(serverOutput, 'x-internal-secret').length).toBeGreaterThan(0)
  })

  test.each(secretMarkers)('no client file contains %s', (marker) => {
    expect(filesContaining(clientOutput, marker)).toEqual([])
  })
})
