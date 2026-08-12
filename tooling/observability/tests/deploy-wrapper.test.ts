import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const wrapper = resolve(repositoryRoot, 'deploy/observability/deploy-via-dokploy.sh')
const temporaryDirectories: string[] = []
const commit = 'a'.repeat(40)
const sourceRef = `observability-v3-${commit}`

function executable(path: string, content: string): void {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-dokploy-wrapper-'))
  temporaryDirectories.push(directory)
  const log = join(directory, 'curl.log')
  const deployMarker = join(directory, 'deployed')
  const gateMarker = join(directory, 'gate-called')

  executable(
    join(directory, 'curl'),
    `#!/bin/sh
cat >/dev/null
printf '%s\n' "$*" >> "$MOCK_CURL_LOG"
case "$*" in
  *compose.one*) printf '%s' '{"command":"compose --parallel 1 -p brawltome-observability-bc1eng -f ./deploy/observability/compose.yml up -d --build --remove-orphans --force-recreate","sourceType":"github","branch":"${sourceRef}","customGitBranch":"stale-inert-ref"}' ;;
  *domain.byComposeId*) printf '%s' '[{"host":"observability.brawltome.app","path":"/","port":3000,"https":true,"certificateType":"letsencrypt","serviceName":"grafana","domainType":"compose","internalPath":"/","stripPath":false,"forwardAuthEnabled":false}]' ;;
  *compose.getConvertedCompose*) printf '%s' '"services: {}"' ;;
  *compose.fetchSourceType*) printf '%s' '{}' ;;
  *compose.deploy*) : > "$MOCK_DEPLOY_MARKER" ;;
esac
`,
  )
  executable(
    join(directory, 'git'),
    `#!/bin/sh
printf '%s\trefs/tags/%s\n' '${commit}' '${sourceRef}'
`,
  )
  executable(
    join(directory, 'docker'),
    `#!/bin/sh
cat >/dev/null
printf '%s' '{}'
`,
  )
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
      DOKPLOY_OBSERVABILITY_COMPOSE_ID: 'compose_safe-id',
      DOKPLOY_OBSERVABILITY_REF: sourceRef,
      DOKPLOY_TOKEN: 'never-log-this-token',
      DOKPLOY_URL: 'https://dokploy.example',
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

describe('Dokploy observability deployment wrapper', () => {
  test('does not deploy when transformed topology verification fails', () => {
    const { deployMarker, env, gateMarker, log } = fixture()
    const result = spawnSync('bash', [wrapper], { cwd: repositoryRoot, encoding: 'utf8', env })

    expect(result.status).toBe(42)
    expect(existsSync(gateMarker)).toBe(true)
    expect(existsSync(deployMarker)).toBe(false)
    expect(readFileSync(log, 'utf8')).not.toContain(env.DOKPLOY_TOKEN)
    expect(readFileSync(log, 'utf8')).not.toContain('compose.deploy')
  })

  test('rejects compose IDs before making an API request', () => {
    const { env, log } = fixture()
    env.DOKPLOY_OBSERVABILITY_COMPOSE_ID = 'approved?composeId=other'
    const result = spawnSync('bash', [wrapper], { cwd: repositoryRoot, encoding: 'utf8', env })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unsupported characters')
    expect(existsSync(log)).toBe(false)
  })

  test('rejects an inert custom Git ref when the active GitHub branch is stale', () => {
    const { deployMarker, env, log } = fixture()
    const curlPath = `${env.PATH.split(':')[0]}/curl`
    const curl = readFileSync(curlPath, 'utf8').replace(`"branch":"${sourceRef}"`, '"branch":"feature/v3-rewrite"')
    writeFileSync(curlPath, curl)

    const result = spawnSync('bash', [wrapper], { cwd: repositoryRoot, encoding: 'utf8', env })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('immutable Dokploy source ref drift')
    expect(existsSync(deployMarker)).toBe(false)
    expect(readFileSync(log, 'utf8')).not.toContain('compose.deploy')
  })
})
