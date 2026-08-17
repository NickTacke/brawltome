import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const verifier = resolve(import.meta.dir, '../backups/verify-dokploy-backup-integrity.sh')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

function backupName(hoursAgo: number): string {
  return `${new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replaceAll(':', '-').replace('.', '-')}.sql.gz`
}

function fixture(hoursAgo = 1) {
  const root = mkdtempSync(join(tmpdir(), 'brawltome-backup-integrity-'))
  temporaryDirectories.push(root)
  const remote = join(root, 'remote')
  const metrics = join(root, 'metrics', 'backup.prom')
  const bin = join(root, 'bin')
  const rclone = join(bin, 'rclone')
  const name = backupName(hoursAgo)
  Bun.spawnSync(['mkdir', '-p', remote, bin, join(root, 'metrics')])
  const compressed = Bun.spawnSync(['gzip', '-c'], { stdin: Buffer.from('verified backup fixture') })
  expect(compressed.exitCode).toBe(0)
  writeFileSync(join(remote, name), compressed.stdout)
  writeFileSync(
    rclone,
    `#!/usr/bin/env bash
set -euo pipefail
command=$1
shift
case "$command" in
  lsf)
    if [[ " $* " == *".sha256"* ]]; then
      for argument in "$@"; do
        if [[ $argument == *.sha256 && -e "$FAKE_REMOTE/$argument" ]]; then printf '%s\\n' "$argument"; fi
      done
    else
      for path in "$FAKE_REMOTE"/*.sql.gz; do [[ -e $path ]] && basename "$path"; done
    fi
    ;;
  cat)
    path=\${1##*/}
    [[ -e "$FAKE_REMOTE/$path" ]] && /bin/cat "$FAKE_REMOTE/$path"
    ;;
  rcat)
    printf '%s\n' 'Failed to copy: operation error S3: PutObject, https response error StatusCode: 501' >&2
    exit 1
    ;;
  copyto)
    source=$1
    path=\${2##*/}
    [[ -f $source && ! -e "$FAKE_REMOTE/$path" ]]
    /bin/cp "$source" "$FAKE_REMOTE/$path"
    ;;
  *) exit 64 ;;
esac
`,
  )
  chmodSync(rclone, 0o755)
  for (const [command, body] of [
    ['flock', '#!/bin/sh\nexit 0\n'],
    ['sha256sum', '#!/bin/sh\nsleep "${FAKE_SHA256_DELAY:-0}"\nexec shasum -a 256 "$@"\n'],
  ] as const) {
    const path = join(bin, command)
    writeFileSync(path, body)
    chmodSync(path, 0o755)
  }
  const env = {
    ...process.env,
    BACKUP_REMOTE: 'R2',
    BACKUP_BUCKET: 'fixture-bucket',
    BACKUP_PREFIX: 'fixture-prefix',
    BACKUP_INTEGRITY_METRICS_FILE: metrics,
    FAKE_REMOTE: remote,
    FAKE_SHA256_DELAY: '0.2',
    LOCK_FILE: join(root, 'verifier.lock'),
    PATH: `${bin}:${process.env.PATH}`,
    RCLONE_BIN: rclone,
    RCLONE_CONFIG_R2_SECRET_ACCESS_KEY: 'must-not-appear',
  }
  return { env, metrics, name, remote }
}

function run(env: Record<string, string | undefined>) {
  return Bun.spawnSync(['bash', verifier], { env, stderr: 'pipe', stdout: 'pipe' })
}

describe('recurring backup integrity verifier', () => {
  test('creates and re-verifies the latest backup sidecar', () => {
    const { env, metrics, name, remote } = fixture()

    const created = run(env)
    expect(created.exitCode, created.stderr.toString()).toBe(0)
    const sidecar = readFileSync(join(remote, `${name}.sha256`), 'utf8')
    const [hash, sidecarName] = sidecar.trimEnd().split('  ')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(sidecarName).toBe(name)
    expect(sidecar.endsWith('\n')).toBe(true)
    expect(readFileSync(metrics, 'utf8')).toContain('brawltome_postgres_backup_integrity_ok 1')

    const verified = run(env)
    expect(verified.exitCode, verified.stderr.toString()).toBe(0)
    expect(readFileSync(join(remote, `${name}.sha256`), 'utf8')).toBe(sidecar)
  })

  test('rejects a checksum mismatch without leaking credentials', () => {
    const { env, metrics, name, remote } = fixture()
    expect(run(env).exitCode).toBe(0)
    writeFileSync(join(remote, `${name}.sha256`), `${'0'.repeat(64)}  ${name}\n`)

    const result = run(env)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('checksum sidecar does not match')
    expect(`${result.stdout}${result.stderr}`).not.toContain('must-not-appear')
    const failedMetrics = readFileSync(metrics, 'utf8')
    expect(failedMetrics).toContain('brawltome_postgres_backup_integrity_ok 0')
    expect(failedMetrics).toMatch(/brawltome_postgres_backup_integrity_latest_verified_timestamp_seconds [1-9][0-9]*/)
  })

  test('publishes failure when required configuration is missing', () => {
    const { env, metrics } = fixture()
    const missingRemoteEnv: Record<string, string | undefined> = { ...env, BACKUP_REMOTE: undefined }

    const result = run(missingRemoteEnv)
    expect(result.exitCode).not.toBe(0)
    expect(readFileSync(metrics, 'utf8')).toContain('brawltome_postgres_backup_integrity_ok 0')
  })

  test('rejects a backup older than the eight-hour verification window', () => {
    const { env, metrics } = fixture(9)

    const result = run(env)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('Latest backup is stale')
    expect(readFileSync(metrics, 'utf8')).toContain('brawltome_postgres_backup_integrity_ok 0')
  })
})
