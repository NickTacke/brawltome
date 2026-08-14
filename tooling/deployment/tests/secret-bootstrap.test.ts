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
printf 'dead-letter-database=%s\\n' "\${DEAD_LETTER_DATABASE_URL:-}"
printf 'dead-letter-tokens=%s\\n' "\${DEAD_LETTER_OPERATOR_TOKENS:-}"
printf 'discord-client-secret=%s\\n' "\${DISCORD_CLIENT_SECRET:-}"
printf 'discord-internal=%s\\n' "\${DISCORD_INTERNAL_API_SECRET:-}"
printf 'internal=%s\\n' "\${INTERNAL_API_SECRET:-}"
printf 'metrics=%s\\n' "\${METRICS_SCRAPE_SECRET:-}"
printf 'otel=%s\\n' "\${OTEL_EXPORTER_OTLP_AUTHORIZATION:-}"
printf 'trust=%s\\n' "\${REFRESH_TRUST_COOKIE_SECRET:-}"
printf 'turnstile=%s\\n' "\${TURNSTILE_SECRET_KEY:-}"
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
      discord_client_secret: 'discord-client-secret-value',
      discord_internal_api_secret: 'discord-internal-secret-value',
      internal_api_secret: 'internal-secret-value',
      metrics_scrape_secret: 'metrics-secret-value',
      otel_authorization: 'Bearer otel-secret-value',
      refresh_trust_cookie_secret: 'trust-secret-value',
      turnstile_secret_key: 'turnstile-secret-value',
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

  test('exports dedicated dead-letter secrets and forwards CLI arguments', () => {
    const values = {
      dead_letter_database_url: 'postgres://dead-letter-operator',
      dead_letter_operator_tokens: '[{"actorId":"operator:test","tokenSha256":"abc"}]',
    }
    const { bin, secrets } = fixture(values)
    const result = spawnSync('sh', [runner, 'dead-letter-cli', 'list', '--limit', '25'], {
      encoding: 'utf8',
      env: { ...process.env, BRAWLTOME_SECRETS_ROOT: secrets, PATH: `${bin}:${process.env.PATH}` },
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('args=run packages/contexts/refresh-operations/cli.ts list --limit 25')
    expect(result.stdout).toContain(`dead-letter-database=${values.dead_letter_database_url}`)
    expect(result.stdout).toContain(`dead-letter-tokens=${values.dead_letter_operator_tokens}`)
    expect(result.stdout.split('\n')[0]).not.toContain('dead-letter')
  })

  test('fails closed without printing a missing secret value', () => {
    const { bin, secrets } = fixture({ runtime_database_url: 'postgres://runtime-secret' })
    const result = spawnSync('sh', [runner, 'api'], {
      encoding: 'utf8',
      env: { ...process.env, BRAWLTOME_SECRETS_ROOT: secrets, PATH: `${bin}:${process.env.PATH}` },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Required secret is unreadable: DISCORD_CLIENT_SECRET')
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
