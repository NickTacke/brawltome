import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const preflight = join(repositoryRoot, 'infra/observability/networks/ensure.sh')
const temporaryDirectories: string[] = []

type FixtureOptions = {
  ambiguous?: string
  args?: string[]
  badAttribute?: string
  createFailure?: string
  inspectError?: string
  missing?: string
  networkName?: string
  swarm?: string
}

function fixture(options: FixtureOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-network-test-'))
  temporaryDirectories.push(directory)
  const bin = join(directory, 'bin')
  const state = join(directory, 'state')
  const log = join(directory, 'docker.log')
  mkdirSync(bin)
  mkdirSync(state)

  const docker = join(bin, 'docker')
  writeFileSync(
    docker,
    `#!/bin/sh
set -eu
missing() {
  [ "\${MOCK_MISSING:-}" = all ] || [ "\${MOCK_MISSING:-}" = "$1" ]
}
network_name() {
  value=$1
  value=\${value#id-}
  value=\${value#created-}
  printf '%s' "$value"
}
if [ "$1" = info ]; then
  printf '%s\\n' "\${MOCK_SWARM_STATE:-active}"
  exit 0
fi
if [ "$1 $2" = 'network ls' ]; then
  for name in brawltome-observability brawltome-notifications "\${BRAWLTOME_NETWORK_NAME}"; do
    if [ -f "$MOCK_STATE/$name" ]; then
      printf 'created-%s|%s\\n' "$name" "$name"
    elif ! missing "$name"; then
      printf 'id-%s|%s\\n' "$name" "$name"
    fi
    if [ "\${MOCK_AMBIGUOUS:-}" = "$name" ]; then
      printf 'duplicate-%s|%s\\n' "$name" "$name"
    fi
  done
  exit 0
fi
if [ "$1 $2" = 'network inspect' ]; then
  name=$(network_name "$3")
  [ "\${MOCK_INSPECT_ERROR:-}" != "$name" ] || exit 42
  driver=overlay
  scope=swarm
  attachable=true
  internal=false
  [ "$name" = brawltome-observability ] && internal=true
  bad_kind= bad_name=
  if [ -n "\${MOCK_BAD_ATTRIBUTE:-}" ]; then
    bad_kind=\${MOCK_BAD_ATTRIBUTE%%:*}
    bad_name=\${MOCK_BAD_ATTRIBUTE#*:}
  fi
  if [ "$bad_name" = "$name" ]; then
    case "$bad_kind" in
      driver) driver=bridge ;;
      scope) scope=local ;;
      attachable) attachable=false ;;
      internal) internal=false ;;
    esac
  fi
  printf '%s|%s|%s|%s\\n' "$driver" "$scope" "$attachable" "$internal"
  exit 0
fi
if [ "$1 $2" = 'network create' ]; then
  for argument in "$@"; do name=$argument; done
  printf '%s\\n' "$*" >> "$MOCK_DOCKER_LOG"
  [ "\${MOCK_CREATE_FAILURE:-}" != "$name" ] || exit 43
  touch "$MOCK_STATE/$name"
  printf 'created-%s\\n' "$name"
  exit 0
fi
if [ "$1 $2" = 'network rm' ]; then
  id=$3
  name=$(network_name "$id")
  printf '%s\\n' "$*" >> "$MOCK_DOCKER_LOG"
  rm -f "$MOCK_STATE/$name"
  exit 0
fi
printf 'unexpected docker invocation: %s\\n' "$*" >&2
exit 1
`,
  )
  chmodSync(docker, 0o755)

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    BRAWLTOME_NETWORK_NAME: options.networkName ?? 'brawltome',
    MOCK_AMBIGUOUS: options.ambiguous ?? '',
    MOCK_BAD_ATTRIBUTE: options.badAttribute ?? '',
    MOCK_CREATE_FAILURE: options.createFailure ?? '',
    MOCK_DOCKER_LOG: log,
    MOCK_INSPECT_ERROR: options.inspectError ?? '',
    MOCK_MISSING: options.missing ?? '',
    MOCK_STATE: state,
    MOCK_SWARM_STATE: options.swarm ?? 'active',
  }
  const run = (args = options.args ?? []) =>
    Bun.spawnSync({
      cmd: ['sh', preflight, ...args],
      cwd: repositoryRoot,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })

  return {
    result: run(),
    run,
    dockerLog: () => (existsSync(log) ? readFileSync(log, 'utf8') : ''),
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('observability network preflight', () => {
  test('accepts the three existing dedicated overlay networks', () => {
    const { result } = fixture()

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(result.stdout.toString()).toContain('Observability network preflight passed')
  })

  test('provisions missing networks with the required isolation and reruns without mutation', () => {
    const { result, run, dockerLog } = fixture({ args: ['--provision'], missing: 'all' })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const firstLog = dockerLog()
    const lines = firstLog.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines.find((line) => line.endsWith('brawltome-observability'))).toContain('--internal')
    expect(lines.find((line) => line.endsWith('brawltome-notifications'))).not.toContain('--internal')
    expect(lines.find((line) => line.endsWith('brawltome'))).not.toContain('--internal')
    for (const line of lines) {
      expect(line).toContain('--driver overlay')
      expect(line).toContain('--attachable')
      expect(line).toContain(' -- ')
    }

    const rerun = run(['--provision'])
    expect(rerun.exitCode, rerun.stderr.toString()).toBe(0)
    expect(dockerLog()).toBe(firstLog)
  })

  test.each([
    ['driver', 'must use driver=overlay'],
    ['scope', 'must have scope=swarm'],
    ['attachable', 'must have attachable=true'],
    ['internal', 'must have internal=true'],
  ])('refuses an existing observability network with wrong %s', (attribute, message) => {
    const { result, dockerLog } = fixture({
      args: ['--provision'],
      badAttribute: `${attribute}:brawltome-observability`,
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain(message)
    expect(dockerLog()).toBe('')
  })

  test('does not treat an inspect failure as a missing network', () => {
    const { result, dockerLog } = fixture({ args: ['--provision'], inspectError: 'brawltome-notifications' })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('cannot inspect brawltome-notifications')
    expect(dockerLog()).toBe('')
  })

  test('rejects ambiguous exact-name discovery', () => {
    const { result, dockerLog } = fixture({ args: ['--provision'], ambiguous: 'brawltome' })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('multiple networks named brawltome')
    expect(dockerLog()).toBe('')
  })

  test('rolls back networks created before a later create failure', () => {
    const { result, dockerLog } = fixture({
      args: ['--provision'],
      createFailure: 'brawltome-notifications',
      missing: 'all',
    })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('cannot create brawltome-notifications')
    expect(dockerLog()).toContain('network rm created-brawltome-observability')
  })

  test('requires explicit provisioning for a missing network', () => {
    const { result } = fixture({ missing: 'brawltome-notifications' })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('rerun with --provision')
  })

  test('rejects extra arguments and option-like network names', () => {
    const extra = fixture({ args: ['--provision', 'unexpected'] }).result
    expect(extra.exitCode).not.toBe(0)
    expect(extra.stderr.toString()).toContain('usage: ensure.sh [--provision]')

    const optionLike = fixture({ networkName: '--scope=local' }).result
    expect(optionLike.exitCode).not.toBe(0)
    expect(optionLike.stderr.toString()).toContain('invalid BRAWLTOME_NETWORK_NAME')
  })

  test('requires active Docker Swarm', () => {
    const { result } = fixture({ swarm: 'inactive' })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('Docker Swarm must be active')
  })
})
