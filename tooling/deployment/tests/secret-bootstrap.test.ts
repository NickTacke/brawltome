import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')
const runner = resolve(root, 'deploy/v3/run-with-secrets.sh')
const temporaryDirectories: string[] = []

function fixture(secretValues: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'brawltome-v3-secrets-'))
  temporaryDirectories.push(directory)
  const secrets = join(directory, 'secrets')
  const bin = join(directory, 'bin')
  mkdirSync(secrets)
  mkdirSync(bin)
  for (const [name, value] of Object.entries(secretValues))
    writeFileSync(join(secrets, name), `${value}\n`, { mode: 0o400 })

  const executable = join(bin, 'bun')
  writeFileSync(
    executable,
    `#!/bin/sh
printf 'args=%s\\n' "$*"
printf 'database=%s\\n' "\${DATABASE_URL:-}"
printf 'discord-internal=%s\\n' "\${DISCORD_INTERNAL_API_SECRET:-}"
printf 'internal=%s\\n' "\${INTERNAL_API_SECRET:-}"
printf 'metrics=%s\\n' "\${METRICS_SCRAPE_SECRET:-}"
printf 'otel=%s\\n' "\${OTEL_EXPORTER_OTLP_AUTHORIZATION:-}"
printf 'trust=%s\\n' "\${REFRESH_TRUST_COOKIE_SECRET:-}"
printf 'r2-access=%s\\n' "\${R2_ACCESS_KEY_ID:-}"
printf 'r2-secret=%s\\n' "\${R2_SECRET_ACCESS_KEY:-}"
printf 'r2-endpoint=%s\\n' "\${R2_ENDPOINT:-}"
printf 'r2-bucket=%s\\n' "\${R2_BUCKET:-}"
`,
  )
  chmodSync(executable, 0o755)
  return { bin, secrets }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('V3 secret bootstrap', () => {
  test('exports API secrets without placing values in command arguments', () => {
    const values = {
      runtime_database_url: 'postgres://runtime-secret',
      discord_internal_api_secret: 'discord-internal-secret-value',
      internal_api_secret: 'internal-secret-value',
      metrics_scrape_secret: 'metrics-secret-value',
      otel_authorization: 'Bearer otel-secret-value',
      refresh_trust_cookie_secret: 'trust-secret-value',
      r2_access_key_id: 'r2-access-key-value',
      r2_secret_access_key: 'r2-secret-key-value',
      r2_endpoint: 'https://r2.example.test',
      r2_bucket: 'r2-bucket-value',
    }
    const { bin, secrets } = fixture(values)
    const result = spawnSync('sh', [runner, 'api'], {
      encoding: 'utf8',
      env: { ...process.env, BRAWLTOME_SECRETS_ROOT: secrets, PATH: `${bin}:${process.env.PATH}` },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('args=run apps/api/src/serve.ts')
    for (const value of Object.values(values)) expect(result.stdout).toContain(value)
    expect(result.stdout.split('\n')[0]).not.toContain('secret')
  })

  test('fails closed without printing a missing secret value', () => {
    const { bin, secrets } = fixture({ runtime_database_url: 'postgres://runtime-secret' })
    const result = spawnSync('sh', [runner, 'api'], {
      encoding: 'utf8',
      env: { ...process.env, BRAWLTOME_SECRETS_ROOT: secrets, PATH: `${bin}:${process.env.PATH}` },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Required secret is unreadable: DISCORD_INTERNAL_API_SECRET')
    expect(result.stderr).not.toContain('postgres://runtime-secret')
  })

  test('rejects unknown roles before executing a runtime', () => {
    const { bin, secrets } = fixture({})
    const result = spawnSync('sh', [runner, 'unknown'], {
      encoding: 'utf8',
      env: { ...process.env, BRAWLTOME_SECRETS_ROOT: secrets, PATH: `${bin}:${process.env.PATH}` },
    })

    expect(result.status).toBe(64)
    expect(result.stderr).toContain('Usage:')
  })
})
