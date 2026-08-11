import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const wrapper = resolve(root, 'deploy/v3/deploy-via-dokploy.sh')
const temporaryDirectories: string[] = []
const commit = 'b'.repeat(40)
const sourceRef = `v3-topology-${commit}`
const projectName = 'brawltome-v3-test'

function executable(path: string, content: string): void {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function fixture(bypassActors: unknown[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-v3-wrapper-'))
  temporaryDirectories.push(directory)
  const log = join(directory, 'curl.log')
  const deployMarker = join(directory, 'deployed')
  const gateMarker = join(directory, 'gate-called')
  const command = `compose --parallel 1 -p ${projectName} -f ./deploy/v3/compose.yml up -d --build --remove-orphans`
  const ruleset = JSON.stringify({
    target: 'tag',
    enforcement: 'active',
    bypass_actors: bypassActors,
    conditions: { ref_name: { include: ['refs/tags/v3-topology-*'], exclude: [] } },
    rules: [{ type: 'update' }, { type: 'deletion' }],
  })

  executable(
    join(directory, 'curl'),
    `#!/bin/sh
cat >/dev/null
printf '%s\n' "$*" >> "$MOCK_CURL_LOG"
case "$*" in
  *compose.one*) printf '%s' '${JSON.stringify({ command, customGitBranch: sourceRef })}' ;;
  *domain.byComposeId*) printf '%s' '[]' ;;
  *compose.getConvertedCompose*) printf '%s' '"services: {}"' ;;
  *compose.fetchSourceType*) printf '%s' '{}' ;;
  *compose.deploy*) : > "$MOCK_DEPLOY_MARKER" ;;
esac
`,
  )
  executable(join(directory, 'git'), `#!/bin/sh\nprintf '%s\\trefs/tags/%s\\n' '${commit}' '${sourceRef}'\n`)
  executable(
    join(directory, 'gh'),
    `#!/bin/sh
printf '%s' '${ruleset}'
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
      DOKPLOY_V3_REF: sourceRef,
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

  test('rejects a deployment-tag bypass actor before rendering', () => {
    const { deployMarker, env } = fixture([{ actor_id: 1, actor_type: 'User', bypass_mode: 'always' }])
    const result = spawnSync('bash', [wrapper], { cwd: root, encoding: 'utf8', env })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('must not allow bypass actors')
    expect(existsSync(deployMarker)).toBe(false)
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
