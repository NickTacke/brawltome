import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const deployScript = resolve(root, 'infra/app/deploy.sh')
const dockerStub = resolve(import.meta.dir, 'fixtures/docker-stub.ts')
const project = 'brawltome-test'
const services = ['postgres', 'migration', 'api', 'web', 'operations-worker']
const appServices = ['api', 'web', 'operations-worker']
const temporaryDirectories: string[] = []

// Failing runs spend the smoke budget (2 s here) once per smoke pass, and every docker call starts a bun process.
setDefaultTimeout(30_000)

type Container = { id: string; service: string; image: string }

function deploy({ firstDeploy = false, env = {} }: { firstDeploy?: boolean; env?: Record<string, string> } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-deploy-'))
  temporaryDirectories.push(directory)
  const bin = join(directory, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'docker'), `#!/bin/sh\nexec '${process.execPath}' '${dockerStub}' "$@"\n`)
  chmodSync(join(bin, 'docker'), 0o755)

  const running = firstDeploy ? ['postgres'] : ['postgres', ...appServices]
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

  const result = spawnSync('sh', [deployScript, project, 'infra/app/compose.yml', 'api', 'web'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOY_ROUTING_SETTLE_SECONDS: '0',
      DEPLOY_SMOKE_RETRY_SECONDS: '0',
      DEPLOY_SMOKE_TIMEOUT_SECONDS: '2',
      DOCKER_STUB_DIR: directory,
      PATH: `${bin}:${process.env.PATH}`,
      ...env,
    },
  })
  const state = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')) as {
    containers: Container[]
    tags: Record<string, string>
  }
  const calls = readFileSync(join(directory, 'calls.log'), 'utf8').trim().split('\n')
  const imageOf = (service: string) => state.containers.filter((item) => item.service === service).map((c) => c.image)
  return { result, state, calls, imageOf }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('deploy smoke checks and rollback', () => {
  test('a release that passes the smoke checks stays and nothing is rolled back', () => {
    const { result, state, calls, imageOf } = deploy()

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    for (const check of ['api /health/ready', 'web /api/health/ready', 'web renders /', 'api leaderboard read'])
      expect(result.stdout).toContain(`smoke: ${check} ok`)
    expect(result.stdout).not.toContain('rolling back')
    for (const service of appServices) {
      expect(imageOf(service)).toEqual([`sha256:new-${service}`])
      expect(state.tags[`${project}-${service}:previous`]).toBe(`sha256:old-${service}`)
    }
    expect(calls.some((call) => call.endsWith(':latest') && call.startsWith('tag '))).toBe(false)
    // The previous images are recorded before anything is built.
    expect(calls.findIndex((call) => call.startsWith(`tag sha256:old-api ${project}-api:previous`))).toBeLessThan(
      calls.findIndex((call) => call.endsWith(' build')),
    )
    // Probes run inside the containers with the runtime each image ships.
    expect(calls).toContainEqual(
      expect.stringMatching(/^exec api-\d+ bun -e .*http:\/\/127\.0\.0\.1:3000\/health\/ready/),
    )
    expect(calls).toContainEqual(expect.stringMatching(/^exec web-\d+ node -e .*http:\/\/127\.0\.0\.1:3000\/'/))
    expect(calls).toContainEqual(expect.stringMatching(/^exec api-\d+ bun -e .*\/trpc\/leaderboard\.get\?input=/))
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
      expect(calls).toContain(`tag ${project}-${service}:previous ${project}-${service}:latest`)
      expect(imageOf(service)).toEqual([`sha256:old-${service}`])
    }
    // The public services roll back beside the failed release, never by stopping it first.
    const rollbackStart = calls.indexOf(`tag ${project}-api:previous ${project}-api:latest`)
    const rollbackCalls = calls.slice(rollbackStart)
    expect(rollbackCalls).toContainEqual(expect.stringContaining('--no-recreate --scale api=2 api'))
    expect(rollbackCalls).toContainEqual(expect.stringContaining('--no-recreate --scale web=2 web'))
    expect(imageOf('postgres')).toEqual(['sha256:old-postgres'])
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

  test('without previous images a failing release fails the deploy without a rollback', () => {
    const { result, state, calls, imageOf } = deploy({ firstDeploy: true, env: { DOCKER_STUB_FAIL_IMAGE: 'new' } })

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('rollback: no previous api image (first deploy?)')
    expect(result.stdout).not.toContain('ROLLED BACK')
    expect(state.tags[`${project}-api:previous`]).toBeUndefined()
    expect(calls.some((call) => call.startsWith('tag ') && call.endsWith(':latest'))).toBe(false)
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
