import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const tunnel = join(repositoryRoot, 'deploy/observability/grafana-tunnel.sh')
const temporaryDirectories: string[] = []

type FixtureOptions = {
  appName?: string
  containerIds?: string
  grafanaIp?: string
  localPort?: string
  monitorSuccess?: boolean
  remoteHealth?: boolean
  remoteReachable?: boolean
}

function executable(path: string, content: string): void {
  writeFileSync(path, `#!/bin/sh\nset -eu\n${content}`)
  chmodSync(path, 0o755)
}

function fixture(options: FixtureOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-grafana-tunnel-test-'))
  temporaryDirectories.push(directory)
  const bin = join(directory, 'bin')
  const log = join(directory, 'ssh.log')
  const monitorFile = join(directory, 'monitor.sh')
  const monitorDockerLog = join(directory, 'monitor-docker.log')
  const replacedFile = join(directory, 'replaced')
  mkdirSync(bin)

  executable(
    join(bin, 'ssh'),
    `for argument in "$@"; do printf '<%s>' "$argument" >> "$MOCK_SSH_LOG"; done
printf '\\n' >> "$MOCK_SSH_LOG"
for argument in "$@"; do remote=$argument; done
case "$remote" in
  *'while '*'docker inspect '*'docker exec '*) printf '%s' "$remote" > "$MOCK_MONITOR_FILE"; [ "\${MOCK_MONITOR_SUCCESS:-true}" = true ] ;;
  *'command -v timeout'*) exit 0 ;;
  *'docker ps --filter label=com.docker.compose.project='*) printf '%s\\n' "\${MOCK_CONTAINER_IDS-abc123}" ;;
  *'docker inspect '*'brawltome-observability'*) printf '%s\\n' "\${MOCK_GRAFANA_IP-10.0.0.5}" ;;
  *'docker exec '*'wget --spider'*) [ "\${MOCK_REMOTE_HEALTH:-true}" = true ] ;;
  *'curl -fsS '*'api/health'*) [ "\${MOCK_REMOTE_REACHABLE:-true}" = true ] ;;
  *) printf 'unexpected remote command: %s\\n' "$remote" >&2; exit 1 ;;
esac`,
  )
  executable(
    join(bin, 'docker'),
    `printf '%s\\n' "$*" >> "$MOCK_MONITOR_DOCKER_LOG"
case "$1" in
  ps) if [ -f "$MOCK_REPLACED_FILE" ]; then echo def456; else echo abc123; fi ;;
  inspect)
    case "$*" in
      *State.Running*) echo true ;;
      *brawltome-observability*) echo 10.0.0.5 ;;
      *) exit 1 ;;
    esac ;;
  exec) exit 0 ;;
  *) exit 1 ;;
esac`,
  )
  executable(join(bin, 'timeout'), 'shift\nexec "$@"')
  executable(join(bin, 'curl'), 'exit 0')
  executable(join(bin, 'sleep'), 'touch "$MOCK_REPLACED_FILE"')

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    DOKPLOY_OBSERVABILITY_APP_NAME: options.appName ?? 'brawltome-observability-bc1eng',
    DOKPLOY_SSH_HOST: 'root@vm3.example',
    GRAFANA_LOCAL_PORT: options.localPort ?? '13000',
    MOCK_CONTAINER_IDS: options.containerIds ?? 'abc123',
    MOCK_GRAFANA_IP: options.grafanaIp ?? '10.0.0.5',
    MOCK_MONITOR_DOCKER_LOG: monitorDockerLog,
    MOCK_MONITOR_FILE: monitorFile,
    MOCK_MONITOR_SUCCESS: String(options.monitorSuccess ?? true),
    MOCK_REMOTE_HEALTH: String(options.remoteHealth ?? true),
    MOCK_REMOTE_REACHABLE: String(options.remoteReachable ?? true),
    MOCK_REPLACED_FILE: replacedFile,
    MOCK_SSH_LOG: log,
  }
  const result = Bun.spawnSync({
    cmd: ['sh', tunnel],
    cwd: repositoryRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  return {
    result,
    monitor: () => readFileSync(monitorFile, 'utf8'),
    monitorDockerLog: () => readFileSync(monitorDockerLog, 'utf8'),
    monitorEnv: env,
    sshCalls: () => readFileSync(log, 'utf8').trim().split('\n'),
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('private Grafana SSH tunnel', () => {
  test('discovers one reachable Grafana container and monitors a loopback-only tunnel', () => {
    const { result, sshCalls } = fixture()

    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const calls = sshCalls()
    expect(calls.find((call) => call.includes('docker ps'))).toContain(
      "<timeout 10 docker ps --filter label=com.docker.compose.project=brawltome-observability-bc1eng --filter label=com.docker.compose.service=grafana --filter status=running --format '{{.ID}}'>",
    )
    expect(calls.find((call) => call.includes('curl -fsS'))).toContain(
      '<curl -fsS --connect-timeout 5 --max-time 10 http://10.0.0.5:3000/api/health>',
    )
    const finalCall = calls.at(-1) ?? ''
    expect(finalCall).toContain('<-o><BatchMode=yes>')
    expect(finalCall).toContain('<-o><ExitOnForwardFailure=yes>')
    expect(finalCall).toContain('<-o><ServerAliveInterval=30>')
    expect(finalCall).toContain('<-T><-L><127.0.0.1:13000:10.0.0.5:3000>')
    expect(finalCall).toContain('<--><root@vm3.example>')
    expect(finalCall).toContain('timeout 5 docker ps')
    expect(finalCall).toContain("timeout 5 docker inspect abc123 --format '{{.State.Running}}'")
    expect(finalCall).toContain('timeout 10 docker exec abc123 wget --spider -q -T 5')
    expect(finalCall).toContain('curl -fsS --connect-timeout 5 --max-time 10 http://10.0.0.5:3000/api/health')
  })

  test('executes recurring checks and exits when the Grafana container is replaced', () => {
    const { monitor, monitorDockerLog, monitorEnv, result } = fixture()
    expect(result.exitCode, result.stderr.toString()).toBe(0)

    const monitorResult = Bun.spawnSync({
      cmd: ['sh', '-c', monitor()],
      env: monitorEnv,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(monitorResult.exitCode).not.toBe(0)
    const dockerCalls = monitorDockerLog().trim().split('\n')
    expect(dockerCalls.filter((call) => call.startsWith('ps '))).toHaveLength(2)
    expect(dockerCalls).toContain('inspect abc123 --format {{.State.Running}}')
    expect(dockerCalls.find((call) => call.startsWith('exec '))).toContain('wget --spider -q -T 5')
  })

  test.each(['', 'abc123\ndef456'])('requires exactly one running Grafana container', (containerIds) => {
    const { result } = fixture({ containerIds })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('expected exactly one running Grafana container')
  })

  test.each(['', '1', '999.1.1.1', '10.0.0.x'])('requires a valid observability overlay IPv4 address', (grafanaIp) => {
    const { result } = fixture({ grafanaIp })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('Grafana has no valid brawltome-observability IPv4 address')
  })

  test('requires both container-local health and host-to-overlay reachability', () => {
    const unhealthy = fixture({ remoteHealth: false }).result
    expect(unhealthy.exitCode).not.toBe(0)
    expect(unhealthy.stderr.toString()).toContain('Grafana container health check failed')

    const unreachable = fixture({ remoteReachable: false }).result
    expect(unreachable.exitCode).not.toBe(0)
    expect(unreachable.stderr.toString()).toContain('Grafana overlay endpoint is unreachable from VM3')
  })

  test('propagates monitor or tunnel failure', () => {
    const { result } = fixture({ monitorSuccess: false })

    expect(result.exitCode).not.toBe(0)
  })

  test('rejects option-like app names and invalid local ports', () => {
    const appName = fixture({ appName: '--host=attacker' }).result
    expect(appName.exitCode).not.toBe(0)
    expect(appName.stderr.toString()).toContain('invalid DOKPLOY_OBSERVABILITY_APP_NAME')

    const port = fixture({ localPort: '70000' }).result
    expect(port.exitCode).not.toBe(0)
    expect(port.stderr.toString()).toContain('GRAFANA_LOCAL_PORT must be between 1024 and 65535')
  })
})
