import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../../..')
const preflight = join(repositoryRoot, 'infra/observability/storage/verify-quota-mounts.sh')
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
  prometheus) capacity=\${MOCK_PROMETHEUS_CAPACITY:-1073741824}; available=\${MOCK_PROMETHEUS_AVAILABLE:-536870912} ;;
  loki) capacity=\${MOCK_LOKI_CAPACITY:-1073741824}; available=\${MOCK_LOKI_AVAILABLE:-536870912} ;;
  tempo) capacity=\${MOCK_TEMPO_CAPACITY:-1073741824}; available=\${MOCK_TEMPO_AVAILABLE:-536870912} ;;
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
  executable(
    join(bin, 'numfmt'),
    `if [ -n "\${MOCK_PROMETHEUS_RETENTION_BYTES:-}" ]; then
  echo "$MOCK_PROMETHEUS_RETENTION_BYTES"
  exit 0
fi
if [ "\${2:-}" != '--' ]; then
  echo 'numfmt invocation does not terminate options' >&2
  exit 1
fi
mode=\${1:-}
value=\${3:-}
case "$mode:$value" in
  --from=iec:0) echo 0 ;;
  --from=iec:800M) echo 838860800 ;;
  --from=iec:9G) echo 9663676416 ;;
  --from=iec:10G) echo 10737418240 ;;
  --from=iec-i:9Gi) echo 9663676416 ;;
  *) echo "numfmt: invalid suffix in input '$value'" >&2; exit 1 ;;
esac`,
  )

  return Bun.spawnSync({
    cmd: ['sh', preflight],
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      OBSERVABILITY_DATA_ROOT: root,
      OBSERVABILITY_METRICS_QUOTA_BYTES: '1073741824',
      OBSERVABILITY_LOGS_QUOTA_BYTES: '1073741824',
      OBSERVABILITY_TRACES_QUOTA_BYTES: '1073741824',
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

  test.each(['9GB', '9GiB'])('accepts Prometheus binary retention size %s', (retentionSize) => {
    const quota = '12884901888'
    const result = fixture({
      OBSERVABILITY_METRICS_QUOTA_BYTES: quota,
      MOCK_PROMETHEUS_CAPACITY: quota,
      MOCK_PROMETHEUS_AVAILABLE: '6000000000',
      PROMETHEUS_RETENTION_SIZE: retentionSize,
    })

    expect(result.exitCode, result.stderr.toString()).toBe(0)
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
      name: 'rejects quota values that exceed safe shell arithmetic',
      env: { OBSERVABILITY_METRICS_QUOTA_BYTES: '291292150460684698' },
      message: 'exceeds the supported byte count',
    },
    {
      name: 'rejects capacity above the declared quota',
      env: { MOCK_TEMPO_CAPACITY: '1073741825' },
      message: 'capacity exceeds declared quota',
    },
    {
      name: 'rejects insufficient deployment headroom',
      env: { MOCK_LOKI_AVAILABLE: '214748363' },
      message: 'less than 20 percent deployment headroom',
    },
    {
      name: 'rejects incorrect service ownership',
      env: { MOCK_BAD_OWNER: 'prometheus' },
      message: 'must be owned by UID 65534',
    },
    {
      name: 'rejects Prometheus retention above 80 percent of quota',
      env: { MOCK_PROMETHEUS_RETENTION_BYTES: '858993460' },
      message: 'exceeds 80 percent',
    },
    {
      name: 'rejects binary retention above 80 percent of quota',
      env: {
        OBSERVABILITY_METRICS_QUOTA_BYTES: '12884901888',
        MOCK_PROMETHEUS_CAPACITY: '12884901888',
        MOCK_PROMETHEUS_AVAILABLE: '6000000000',
        PROMETHEUS_RETENTION_SIZE: '10GB',
      },
      message: 'exceeds 80 percent',
    },
    {
      name: 'rejects zero-byte Prometheus retention',
      env: { PROMETHEUS_RETENTION_SIZE: '0B' },
      message: 'must be a positive byte count',
    },
    {
      name: 'rejects option-like malformed retention',
      env: { PROMETHEUS_RETENTION_SIZE: '--from=noneB' },
      message: 'invalid PROMETHEUS_RETENTION_SIZE',
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
