import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const preflight = join(repositoryRoot, 'deploy/observability/storage/verify-quota-mounts.sh')
const temporaryDirectories: string[] = []

function executable(path: string, content: string): void {
  writeFileSync(path, `#!/bin/sh\nset -eu\n${content}`)
  chmodSync(path, 0o755)
}

function fixture(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-quota-test-'))
  temporaryDirectories.push(directory)
  const root = join(directory, 'storage')
  const bin = join(directory, 'bin')
  mkdirSync(bin)
  for (const name of ['prometheus', 'loki', 'tempo']) mkdirSync(join(root, name), { recursive: true })

  executable(
    join(bin, 'mountpoint'),
    `for argument in "$@"; do path=$argument; done
name=$(basename "$path")
[ "\${MOCK_UNMOUNTED:-}" != "$name" ]`,
  )
  executable(
    join(bin, 'findmnt'),
    `field=''
previous=''
for argument in "$@"; do
  path=$argument
  if [ "$previous" = -o ]; then field=$argument; fi
  previous=$argument
done
name=$(basename "$path")
if [ "$field" = 'MAJ:MIN' ]; then
  if [ "\${MOCK_SHARED_DEVICE:-0}" = 1 ]; then echo '8:1'
  elif [ "$name" = prometheus ]; then echo '8:1'
  elif [ "$name" = loki ]; then echo '8:2'
  else echo '8:3'
  fi
else
  echo "/dev/root[/$name]"
fi`,
  )
  executable(
    join(bin, 'df'),
    `mode=$2
for argument in "$@"; do path=$argument; done
name=$(basename "$path")
case "$name" in
  prometheus) capacity=\${MOCK_PROMETHEUS_CAPACITY:-1000000000}; available=\${MOCK_PROMETHEUS_AVAILABLE:-500000000} ;;
  loki) capacity=\${MOCK_LOKI_CAPACITY:-1000000000}; available=\${MOCK_LOKI_AVAILABLE:-500000000} ;;
  tempo) capacity=\${MOCK_TEMPO_CAPACITY:-1000000000}; available=\${MOCK_TEMPO_AVAILABLE:-500000000} ;;
esac
if [ "$mode" = --output=size ]; then printf 'Size\\n%s\\n' "$capacity"; else printf 'Avail\\n%s\\n' "$available"; fi`,
  )
  executable(
    join(bin, 'stat'),
    `for argument in "$@"; do path=$argument; done
name=$(basename "$path")
if [ "\${MOCK_BAD_OWNER:-}" = "$name" ]; then echo 0
elif [ "$name" = prometheus ]; then echo 65534
else echo 10001
fi`,
  )
  executable(join(bin, 'numfmt'), `echo "\${MOCK_PROMETHEUS_RETENTION_BYTES:-800000000}"`)

  return Bun.spawnSync({
    cmd: ['sh', preflight],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      OBSERVABILITY_DATA_ROOT: root,
      OBSERVABILITY_METRICS_QUOTA_BYTES: '1000000000',
      OBSERVABILITY_LOGS_QUOTA_BYTES: '1000000000',
      OBSERVABILITY_TRACES_QUOTA_BYTES: '1000000000',
      PROMETHEUS_RETENTION_SIZE: '800MB',
      ...overrides,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('telemetry quota mount preflight', () => {
  test('accepts three distinct correctly owned quota filesystems with headroom', () => {
    const result = fixture()
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(result.stdout.toString()).toContain('three distinct dedicated telemetry filesystems')
  })

  const failureCases: Array<{ name: string; env: Record<string, string>; message: string }> = [
    {
      name: 'rejects a directory that is not a mountpoint',
      env: { MOCK_UNMOUNTED: 'loki' },
      message: 'not a dedicated mountpoint',
    },
    {
      name: 'rejects different bind sources sharing one filesystem device',
      env: { MOCK_SHARED_DEVICE: '1' },
      message: 'shares filesystem device 8:1',
    },
    {
      name: 'rejects capacity above the declared quota',
      env: { MOCK_TEMPO_CAPACITY: '1000000001' },
      message: 'capacity exceeds declared quota',
    },
    {
      name: 'rejects insufficient deployment headroom',
      env: { MOCK_LOKI_AVAILABLE: '199999999' },
      message: 'less than 20 percent deployment headroom',
    },
    {
      name: 'rejects incorrect service ownership',
      env: { MOCK_BAD_OWNER: 'prometheus' },
      message: 'must be owned by UID 65534',
    },
    {
      name: 'rejects Prometheus retention above 80 percent of quota',
      env: { MOCK_PROMETHEUS_RETENTION_BYTES: '800000001' },
      message: 'exceeds 80 percent',
    },
  ]

  for (const testCase of failureCases) {
    test(testCase.name, () => {
      const result = fixture(testCase.env)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(testCase.message)
    })
  }
})
