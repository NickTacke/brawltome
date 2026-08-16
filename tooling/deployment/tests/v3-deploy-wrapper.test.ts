import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const wrapper = resolve(root, 'deploy/v3/deploy-via-dokploy.sh')
const temporaryDirectories: string[] = []
const sourceBranch = 'master'
const projectName = 'brawltome-v3-test'

function executable(path: string, content: string): void {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function fixture(
  branch = sourceBranch,
  domains: unknown[] = [
    { host: 'api.brawltome.app', serviceName: 'v3-api' },
    { host: 'brawltome.app', serviceName: 'v3-web' },
  ],
  autoDeploy = true,
) {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-v3-wrapper-'))
  temporaryDirectories.push(directory)
  const log = join(directory, 'curl.log')
  const deployMarker = join(directory, 'deployed')
  const gateMarker = join(directory, 'gate-called')
  const command = `compose --parallel 1 -p ${projectName} -f ./deploy/v3/compose.yml up -d --build --remove-orphans`
  executable(
    join(directory, 'curl'),
    `#!/bin/sh
cat >/dev/null
printf '%s\n' "$*" >> "$MOCK_CURL_LOG"
case "$*" in
  *compose.one*) printf '%s' '${JSON.stringify({
    autoDeploy,
    branch,
    command,
    customGitBranch: branch,
    sourceType: 'github',
  })}' ;;
  *domain.byComposeId*) printf '%s' '${JSON.stringify(domains)}' ;;
  *compose.getConvertedCompose*) printf '%s' '"services: {}"' ;;
  *compose.fetchSourceType*) printf '%s' '{}' ;;
  *compose.deploy*) : > "$MOCK_DEPLOY_MARKER" ;;
esac
`,
  )
  executable(join(directory, 'docker'), `#!/bin/sh\ncat >/dev/null\nprintf '%s' '{}'\n`)
  executable(
    join(directory, 'bun'),
    `#!/bin/sh
cat >/dev/null
: > "$MOCK_GATE_MARKER"
exit 42
`,
  )

  return {
    deployMarker,
    env: {
      ...process.env,
      DOKPLOY_TOKEN: 'never-log-this-token',
      DOKPLOY_URL: 'https://dokploy.example',
      DOKPLOY_V3_COMPOSE_ID: 'compose_safe-id',
      DOKPLOY_V3_PROJECT_NAME: projectName,
      V3_DISCORD_CLIENT_ID: '123456789012345678',
      V3_TURNSTILE_SITE_KEY: 'test-site-key',
      MOCK_CURL_LOG: log,
      MOCK_DEPLOY_MARKER: deployMarker,
      MOCK_GATE_MARKER: gateMarker,
      PATH: `${directory}:${process.env.PATH}`,
    },
    gateMarker,
    log,
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('V3 Dokploy deployment wrapper', () => {
  test('does not deploy after transformed topology rejection', () => {
    const { deployMarker, env, gateMarker, log } = fixture()
    const result = spawnSync('bash', [wrapper], { cwd: root, encoding: 'utf8', env })

    expect(result.status).toBe(42)
    expect(existsSync(gateMarker)).toBe(true)
    expect(existsSync(deployMarker)).toBe(false)
    expect(readFileSync(log, 'utf8')).not.toContain(env.DOKPLOY_TOKEN)
    expect(readFileSync(log, 'utf8')).not.toContain('compose.deploy')
  })

  test('rejects source branch drift before rendering', () => {
    const { deployMarker, env } = fixture('unexpected-branch')
    const result = spawnSync('bash', [wrapper], { cwd: root, encoding: 'utf8', env })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('source branch drift')
    expect(existsSync(deployMarker)).toBe(false)
  })

  test('requires automatic deployment from master', () => {
    const { deployMarker, env } = fixture(sourceBranch, undefined, false)
    const result = spawnSync('bash', [wrapper], { cwd: root, encoding: 'utf8', env })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('automatic deployment must be enabled')
    expect(existsSync(deployMarker)).toBe(false)
  })

  test('rejects public domain drift before rendering', () => {
    const { deployMarker, env, gateMarker } = fixture(sourceBranch, [
      { host: 'unexpected.example', serviceName: 'v3-web' },
    ])
    const result = spawnSync('bash', [wrapper], { cwd: root, encoding: 'utf8', env })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('public V3 domain metadata drift')
    expect(existsSync(gateMarker)).toBe(false)
    expect(existsSync(deployMarker)).toBe(false)
  })

  test('requires the Discord OAuth client ID before any API request', () => {
    const { env, log } = fixture()
    const { V3_DISCORD_CLIENT_ID: _clientId, ...withoutClientId } = env
    const result = spawnSync('bash', [wrapper], { cwd: root, encoding: 'utf8', env: withoutClientId })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('V3_DISCORD_CLIENT_ID')
    expect(existsSync(log)).toBe(false)
  })

  test('requires the public Turnstile site key before any API request', () => {
    const { env, log } = fixture()
    const { V3_TURNSTILE_SITE_KEY: _siteKey, ...withoutSiteKey } = env
    const result = spawnSync('bash', [wrapper], { cwd: root, encoding: 'utf8', env: withoutSiteKey })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('V3_TURNSTILE_SITE_KEY')
    expect(existsSync(log)).toBe(false)
  })

  test('rejects unsafe identifiers before any API request', () => {
    const { env, log } = fixture()
    env.DOKPLOY_V3_PROJECT_NAME = 'approved;other-command'
    const result = spawnSync('bash', [wrapper], { cwd: root, encoding: 'utf8', env })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unsupported characters')
    expect(existsSync(log)).toBe(false)
  })
})
