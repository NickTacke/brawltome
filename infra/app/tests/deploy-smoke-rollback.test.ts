import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const deployScript = resolve(root, 'infra/app/deploy.sh')
const dockerStub = resolve(import.meta.dir, 'fixtures/docker-stub.ts')
const project = 'brawltome-test'
const services = ['postgres', 'migration', 'api', 'site', 'web', 'operations-worker']
const appServices = ['api', 'site', 'web', 'operations-worker']
const releaseSha = 'a'.repeat(40)
const temporaryDirectories: string[] = []

// Failing runs spend the smoke budget (2 s here) once per smoke pass, and every docker call starts a bun process.
setDefaultTimeout(30_000)

type Container = { id: string; service: string; image: string }

function releaseImage(service: string, sha = releaseSha) {
  return `ghcr.io/nicktacke/brawltome-${service}:${sha}`
}

// Dokploy's checkout, as the deploy container sees it: HEAD names a branch whose commit only packed-refs holds.
function writeCheckout(directory: string, sha: string) {
  mkdirSync(join(directory, '.git'), { recursive: true })
  writeFileSync(join(directory, '.git', 'HEAD'), 'ref: refs/heads/master\n')
  writeFileSync(join(directory, '.git', 'packed-refs'), `# pack-refs\n${sha} refs/heads/master\n`)
}

type DeployOptions = {
  firstDeploy?: boolean
  /** App services this release adds, so nothing runs them before the deploy. */
  newServices?: string[]
  env?: Record<string, string>
}

function deploy({ firstDeploy = false, newServices = [], env = {} }: DeployOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-deploy-'))

  temporaryDirectories.push(directory)
  const bin = join(directory, 'bin')

  mkdirSync(bin)
  const checkout = join(directory, 'checkout')

  writeCheckout(checkout, releaseSha)
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\nexec '${process.execPath}' '${dockerStub}' "$@"\n`)
  chmodSync(join(bin, 'docker'), 0o755)

  const runningAppServices = appServices.filter((service) => !newServices.includes(service))
  const running = firstDeploy ? ['postgres'] : ['postgres', ...runningAppServices]

  const containers: Container[] = running.map((service) => ({
    id: `${service}-old`,
    service,
    image: `sha256:old-${service}`,
  }))

  const tags = Object.fromEntries(running.map((service) => [`${project}-${service}:latest`, `sha256:old-${service}`]))

  // A tag left by some earlier deploy; it must never be restored when nothing runs that image.
  if (firstDeploy) tags[`${project}-api:previous`] = 'sha256:stale-api'

  writeFileSync(
    join(directory, 'state.json'),
    JSON.stringify({ project, services, containers, tags, counter: 0, execCalls: 0 }),
  )

  const { BRAWLTOME_IMAGE_TAG: _inherited, ...inheritedEnv } = process.env

  const result = spawnSync('sh', [deployScript, project, 'infra/app/compose.yml', 'api', 'web'], {
    cwd: checkout,
    encoding: 'utf8',
    env: {
      ...inheritedEnv,
      DEPLOY_ROUTING_SETTLE_SECONDS: '0',
      DEPLOY_SMOKE_RETRY_SECONDS: '0',
      DEPLOY_SMOKE_TIMEOUT_SECONDS: '2',
      DOCKER_STUB_DIR: directory,
      PATH: `${bin}:${inheritedEnv.PATH}`,
      ...env,
    },
  })

  const state = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')) as {
    containers: Container[]
    tags: Record<string, string>
    outages?: string[]
  }

  // Whatever fails, api and web must keep a healthy container serving from the moment they first have one.
  expect(state.outages ?? []).toEqual([])

  // a run rejected before any docker call leaves no logs
  const readLines = (name: string) =>
    existsSync(join(directory, name)) ? readFileSync(join(directory, name), 'utf8').trim().split('\n') : []

  const calls = readLines('calls.log')
  const releaseTags = readLines('release-tags.log')
  const imageOf = (service: string) => state.containers.filter((item) => item.service === service).map((c) => c.image)

  return { result, state, calls, imageOf, releaseTags }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('deploy smoke checks and rollback', () => {
  test('a release that passes the smoke checks stays and nothing is rolled back', () => {
    const { result, state, calls, imageOf } = deploy()

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    for (const check of [
      'api /health/ready',
      'web /api/health/ready',
      'web renders /',
      'site renders /privacy',
      'api leaderboard read',
    ])
      expect(result.stdout).toContain(`smoke: ${check} ok`)
    expect(result.stdout).not.toContain('rolling back')
    for (const service of appServices) {
      expect(imageOf(service)).toEqual([`sha256:new-${service}`])
      expect(state.tags[`${project}-${service}:previous`]).toBe(`sha256:old-${service}`)
    }

    expect(calls.some((call) => call.startsWith('tag ') && !call.endsWith(':previous'))).toBe(false)

    // The previous images are recorded before the release images are pulled.
    expect(calls.findIndex((call) => call.startsWith(`tag sha256:old-api ${project}-api:previous`))).toBeLessThan(
      calls.findIndex((call) => call.includes(' pull ')),
    )

    // Probes run inside the containers with the runtime each image ships.
    expect(calls).toContainEqual(
      expect.stringMatching(/^exec api-\d+ bun -e .*http:\/\/127\.0\.0\.1:3000\/health\/ready/),
    )

    expect(calls).toContainEqual(expect.stringMatching(/^exec web-\d+ node -e .*http:\/\/127\.0\.0\.1:3000\/'/))
    expect(calls).toContainEqual(expect.stringMatching(/^exec site-\d+ bun -e .*http:\/\/127\.0\.0\.1:3000\/privacy'/))
    expect(calls).toContainEqual(expect.stringMatching(/^exec api-\d+ bun -e .*\/trpc\/leaderboard\.get\?input=/))
  })

  test('a deploy pulls the release images instead of building them', () => {
    const { result, calls } = deploy()

    expect(result.status).toBe(0)
    const pulls = calls.filter((call) => call.includes(' pull '))

    expect(pulls).toHaveLength(1)
    expect(pulls[0]).toEndWith(' pull --quiet api site web operations-worker migration')
    expect(calls.some((call) => call.includes(' build'))).toBe(false)
  })

  test('a missing release image fails the deploy before any container changes', () => {
    const { result, calls, imageOf } = deploy({ env: { DOCKER_STUB_FAIL_PULL: '1' } })

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain(`pull failed for release ${releaseSha}: its images may not be pushed yet`)
    expect(result.stderr).toContain(releaseImage('api'))
    const afterPull = calls.slice(calls.findIndex((call) => call.includes(' pull ')) + 1)

    expect(afterPull.filter((call) => /^(stop|rm|up) /.test(call) || call.includes(' up '))).toEqual([])
    for (const service of appServices) expect(imageOf(service)).toEqual([`sha256:old-${service}`])
  })

  test('the release tag comes from the checked-out commit', () => {
    const { result, releaseTags } = deploy()

    expect(result.status).toBe(0)
    expect(new Set(releaseTags)).toEqual(new Set([releaseSha]))
  })

  test('BRAWLTOME_IMAGE_TAG from the environment wins over the checkout', () => {
    const override = 'b'.repeat(40)
    const { result, releaseTags, imageOf } = deploy({ env: { BRAWLTOME_IMAGE_TAG: override } })

    expect(result.status).toBe(0)
    expect(new Set(releaseTags)).toEqual(new Set([override]))
    expect(imageOf('api')).toEqual(['sha256:new-api'])
  })

  test('a release commit that is not a 40-character sha is rejected before any compose call', () => {
    const { result, calls } = deploy({ env: { BRAWLTOME_IMAGE_TAG: 'abc' } })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("release commit 'abc' is not a 40-character sha")
    expect(calls).toEqual([])
  })

  test('smoke checks retry before they give up', () => {
    const { result, imageOf } = deploy({ env: { DOCKER_STUB_FAIL_PROBES: '2' } })

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('FAILED')
    expect(imageOf('api')).toEqual(['sha256:new-api'])
  })

  test('a release that fails the smoke checks is rolled back to the previous images and the deploy fails', () => {
    const { result, calls, imageOf } = deploy({ env: { DOCKER_STUB_FAIL_IMAGE: 'new' } })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('smoke: api /health/ready FAILED: HTTP 500')
    expect(result.stdout).toContain('SMOKE CHECKS FAILED: rolling back to the previous release')
    expect(result.stdout).toContain('ROLLED BACK: the previous release is serving again')
    for (const service of appServices) {
      expect(calls).toContain(`tag ${project}-${service}:previous ${releaseImage(service)}`)
      expect(imageOf(service)).toEqual([`sha256:old-${service}`])
    }

    // The public services roll back beside the failed release, never by stopping it first.
    const rollbackStart = calls.indexOf(`tag ${project}-api:previous ${releaseImage('api')}`)
    const rollbackCalls = calls.slice(rollbackStart)

    expect(rollbackCalls).toContainEqual(expect.stringContaining('--no-recreate --scale api=2 api'))
    expect(rollbackCalls).toContainEqual(expect.stringContaining('--no-recreate --scale web=2 web'))
    expect(imageOf('postgres')).toEqual(['sha256:old-postgres'])
  })

  test('a release whose site cannot render a page is rolled back', () => {
    const { result, imageOf } = deploy({ env: { DOCKER_STUB_FAIL_IMAGE: 'new-site' } })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('smoke: site renders /privacy FAILED: HTTP 500')
    expect(result.stdout).toContain('ROLLED BACK: the previous release is serving again')
    for (const service of appServices) expect(imageOf(service)).toEqual([`sha256:old-${service}`])
  })

  test('a first site deploy that cannot render a page rolls the rest back and leaves site in place', () => {
    const { result, imageOf } = deploy({ newServices: ['site'], env: { DOCKER_STUB_FAIL_IMAGE: 'new-site' } })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('rollback: no previous site image; it keeps running this release')
    expect(result.stdout).toContain('ROLLED BACK, but the previous release fails the smoke checks too')
    expect(imageOf('api')).toEqual(['sha256:old-api'])
    expect(imageOf('web')).toEqual(['sha256:old-web'])
    expect(imageOf('site')).toEqual(['sha256:new-site'])
  })

  test('a rollback points the configured release image back at the previous image', () => {
    const { result, state, calls } = deploy({ env: { DEPLOY_SMOKE_FORCE_FAILURE: '1' } })

    expect(result.status).toBe(1)
    expect(calls).toContain(`tag ${project}-api:previous ${releaseImage('api')}`)
    expect(state.tags[releaseImage('api')]).toBe('sha256:old-api')
  })

  test('a forced smoke failure exercises the rollback of a healthy release', () => {
    const { result, imageOf } = deploy({ env: { DEPLOY_SMOKE_FORCE_FAILURE: '1' } })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('smoke: failing on purpose')
    expect(result.stdout).toContain('ROLLED BACK: the previous release is serving again')
    expect(imageOf('api')).toEqual(['sha256:old-api'])
  })

  test('a rollback that also fails the smoke checks says the cause may lie outside the release', () => {
    const { result, imageOf } = deploy({ env: { DOCKER_STUB_FAIL_IMAGE: 'sha256:' } })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('ROLLED BACK, but the previous release fails the smoke checks too')
    expect(imageOf('web')).toEqual(['sha256:old-web'])
  })

  test('a public service whose previous image fails its health check keeps serving the current release', () => {
    const { result, state, calls, imageOf } = deploy({
      env: { DOCKER_STUB_FAIL_IMAGE: 'new', DOCKER_STUB_UNHEALTHY_IMAGE: 'old-api' },
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('api: the new container never became healthy; keeping the old one')
    expect(result.stdout).toContain('rollback: api could not be restored; it keeps running this release')
    expect(result.stdout).toContain('ROLLBACK INCOMPLETE')
    expect(imageOf('api')).toEqual(['sha256:new-api'])
    expect(imageOf('web')).toEqual(['sha256:old-web'])
    expect(imageOf('operations-worker')).toEqual(['sha256:old-operations-worker'])
    // The tag follows what api runs, so a later `compose up` does not swap in the image that just failed.
    expect(state.tags[releaseImage('api')]).toBe('sha256:new-api')
    // Rollback convergence never names a public service, which compose would recreate in place.
    const rollbackCalls = calls.slice(calls.indexOf(`tag ${project}-api:previous ${releaseImage('api')}`))
    const converges = rollbackCalls.filter((call) => call.includes(' up -d --remove-orphans '))

    expect(converges).toHaveLength(1)
    expect(converges[0]).toEndWith(' operations-worker')
  })

  test('when no public service can be restored both keep serving and the rest still roll back', () => {
    const { result, state, imageOf } = deploy({
      env: { DOCKER_STUB_FAIL_IMAGE: 'new', DOCKER_STUB_UNHEALTHY_IMAGE: 'old-api,old-web,old-operations-worker' },
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('rollback: api could not be restored')
    expect(result.stdout).toContain('rollback: web could not be restored')
    expect(imageOf('api')).toEqual(['sha256:new-api'])
    expect(imageOf('web')).toEqual(['sha256:new-web'])
    expect(state.tags[releaseImage('web')]).toBe('sha256:new-web')
    // The worker is not public: it is recreated on its previous image, which here fails its health check too.
    expect(imageOf('operations-worker')).toEqual(['sha256:old-operations-worker'])
  })

  test('a public service whose tag cannot be pointed back is not rolled onto the rejected image', () => {
    const { result, state, calls, imageOf } = deploy({
      env: { DOCKER_STUB_FAIL_IMAGE: 'new', DOCKER_STUB_FAIL_TAG: `${project}-api:previous` },
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain(`rollback: could not point ${releaseImage('api')} at the previous image`)
    expect(result.stdout).toContain('ROLLBACK INCOMPLETE')
    expect(result.stdout).not.toContain('ROLLED BACK:')
    // api keeps its one serving container; the rollback never started a second api on the rejected image.
    expect(imageOf('api')).toEqual(['sha256:new-api'])
    expect(state.tags[releaseImage('api')]).toBe('sha256:new-api')
    const rollbackCalls = calls.slice(calls.indexOf(`tag ${project}-api:previous ${releaseImage('api')}`))

    expect(rollbackCalls.some((call) => call.includes('--scale api='))).toBe(false)
    // The rest still roll back.
    expect(imageOf('web')).toEqual(['sha256:old-web'])
    expect(imageOf('operations-worker')).toEqual(['sha256:old-operations-worker'])
  })

  test('a background service whose tag cannot be pointed back is left out of the rollback convergence', () => {
    const { result, calls, imageOf } = deploy({
      env: { DOCKER_STUB_FAIL_IMAGE: 'new', DOCKER_STUB_FAIL_TAG: `${project}-operations-worker:previous` },
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('ROLLBACK INCOMPLETE')
    expect(imageOf('api')).toEqual(['sha256:old-api'])
    expect(imageOf('web')).toEqual(['sha256:old-web'])
    expect(imageOf('operations-worker')).toEqual(['sha256:new-operations-worker'])
    expect(imageOf('site')).toEqual(['sha256:old-site'])
    const rollbackCalls = calls.slice(calls.indexOf(`tag ${project}-api:previous ${releaseImage('api')}`))
    const converges = rollbackCalls.filter((call) => call.includes(' up -d --remove-orphans '))

    expect(converges).toHaveLength(1)
    expect(converges[0]).toEndWith(' site')
  })

  test('a forward roll whose new container fails its health check stops the deploy and keeps the old one', () => {
    const { result, imageOf } = deploy({ env: { DOCKER_STUB_UNHEALTHY_IMAGE: 'new-api' } })

    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('api: the new container never became healthy; keeping the old one')
    expect(imageOf('api')).toEqual(['sha256:old-api'])
    expect(imageOf('web')).toEqual(['sha256:old-web'])
  })

  test('without previous images a failing release fails the deploy without a rollback', () => {
    const { result, state, calls, imageOf } = deploy({ firstDeploy: true, env: { DOCKER_STUB_FAIL_IMAGE: 'new' } })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('rollback: no previous api image (first deploy?)')
    expect(result.stdout).not.toContain('ROLLED BACK')
    expect(state.tags[`${project}-api:previous`]).toBeUndefined()
    expect(calls.some((call) => call.startsWith('tag ') && call.endsWith(releaseImage('api')))).toBe(false)
    expect(imageOf('api')).toEqual(['sha256:new-api'])
  })

  test('DEPLOY_SMOKE=0 skips the checks', () => {
    const { result, calls } = deploy({ env: { DEPLOY_SMOKE: '0', DOCKER_STUB_FAIL_IMAGE: 'new' } })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('smoke checks skipped')
    expect(calls.some((call) => call.startsWith('exec '))).toBe(false)
  })

  test('the script parses as POSIX sh', () => {
    expect(spawnSync('sh', ['-n', deployScript]).status).toBe(0)
  })
})
