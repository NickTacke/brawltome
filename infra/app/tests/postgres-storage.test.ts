import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const preflight = resolve(root, 'infra/app/storage/verify-postgres-mount.sh')
const temporaryDirectories: string[] = []

function fixture(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-postgres-storage-'))
  temporaryDirectories.push(directory)
  const bin = join(directory, 'bin')
  const data = join(directory, 'postgres')
  mkdirSync(bin)
  mkdirSync(data)

  const executable = (name: string, body: string) => {
    const path = join(bin, name)
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
  }
  executable(
    'findmnt',
    `case "$*" in
*'-o TARGET'*) printf '%s\n' "\${MOCK_TARGET}" ;;
*'-o SOURCE'*) printf '%s\n' '/dev/loop9' ;;
*'-o FSTYPE'*) printf '%s\n' "\${MOCK_FSTYPE}" ;;
*'-o OPTIONS'*) printf '%s\n' "\${MOCK_OPTIONS}" ;;
esac`,
  )
  executable('blockdev', `printf '%s\n' "\${MOCK_SIZE}"`)
  executable('losetup', `printf '%s\n' "\${MOCK_BACKING}"`)
  executable(
    'stat',
    `case "$*" in
*'-c %u:%g'*) printf '%s\n' "\${MOCK_OWNER}" ;;
*'-c %s'*) printf '%s\n' "\${MOCK_LOGICAL_SIZE}" ;;
*'-c %b'*) printf '%s\n' "\${MOCK_ALLOCATED_BLOCKS}" ;;
*' /') printf '%s\n' '1' ;;
*) printf '%s\n' "\${MOCK_DEVICE}" ;;
esac`,
  )
  executable('df', `printf 'Avail\n%s\n' "\${MOCK_AVAILABLE}"`)

  return {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      POSTGRES_DATA_ROOT: data,
      POSTGRES_MIN_FREE_BYTES: '2147483648',
      POSTGRES_QUOTA_BYTES: '25769803776',
      MOCK_ALLOCATED_BLOCKS: '50331648',
      MOCK_AVAILABLE: '20000000000',
      MOCK_BACKING: join(directory, 'postgres.ext4'),
      MOCK_DEVICE: '9',
      MOCK_FSTYPE: 'ext4',
      MOCK_LOGICAL_SIZE: '25769803776',
      MOCK_OPTIONS: 'rw,nosuid,nodev,noexec,relatime',
      MOCK_OWNER: '70:70',
      MOCK_SIZE: '25769803776',
      MOCK_TARGET: data,
      ...overrides,
    },
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('PostgreSQL storage preflight', () => {
  test('accepts the dedicated quota-backed mount', () => {
    const result = spawnSync('sh', [preflight], { encoding: 'utf8', ...fixture() })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('PostgreSQL storage preflight passed')
  })

  test.each([
    ['mountpoint', { MOCK_TARGET: '/' }, 'not the exact mountpoint'],
    ['filesystem', { MOCK_FSTYPE: 'xfs' }, 'must use ext4'],
    ['ownership', { MOCK_OWNER: '0:0' }, 'must be owned by 70:70'],
    ['device', { MOCK_DEVICE: '1' }, 'must use a device distinct from root'],
    ['size', { MOCK_SIZE: '25769803777' }, 'size does not match'],
    ['headroom', { MOCK_AVAILABLE: '1000' }, 'insufficient free space'],
    ['options', { MOCK_OPTIONS: 'rw,relatime' }, 'missing mount option'],
    ['missing backing', { MOCK_BACKING: '' }, 'loop backing file is unavailable'],
    ['backing size', { MOCK_LOGICAL_SIZE: '25769803775' }, 'backing file size does not match'],
    ['sparse backing', { MOCK_ALLOCATED_BLOCKS: '1' }, 'backing file is sparse'],
  ])('rejects %s drift', (_name, override, message) => {
    const result = spawnSync('sh', [preflight], { encoding: 'utf8', ...fixture(override) })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })

  test('rejects arguments and unsafe numeric configuration', () => {
    const withArgument = spawnSync('sh', [preflight, '--force'], { encoding: 'utf8', ...fixture() })
    const unsafeQuota = spawnSync('sh', [preflight], {
      encoding: 'utf8',
      ...fixture({ POSTGRES_QUOTA_BYTES: '01' }),
    })
    expect(withArgument.status).toBe(64)
    expect(unsafeQuota.status).toBe(1)
  })
})
