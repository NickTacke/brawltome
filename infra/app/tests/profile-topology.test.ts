import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')

function renderCompose(profile: 'discord' | 'operator') {
  const result = Bun.spawnSync({
    cmd: ['docker', 'compose', '--profile', profile, '-f', 'infra/app/compose.yml', 'config', '--format', 'json'],
    cwd: root,
    env: {
      ...process.env,
      DISCORD_CLIENT_ID: '123456789012345678',
      POSTGRES_DATA_ROOT: '/srv/brawltome/postgres',
      TURNSTILE_SITE_KEY: 'test-site-key',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return JSON.parse(result.stdout.toString()) as {
    services: Record<
      string,
      {
        build?: { target?: string }
        cap_drop?: string[]
        depends_on?: Record<string, { condition?: string }>
        environment?: Record<string, string>
        init?: boolean
        networks?: Record<string, unknown>
        ports?: unknown[]
        profiles?: string[]
        read_only?: boolean
        restart?: string
        secrets?: Array<{ source: string }>
        security_opt?: string[]
        user?: string
      }
    >
  }
}

describe('application profile topology', () => {
  test('keeps Discord internal, hardened, and dependent on API readiness', () => {
    const discord = renderCompose('discord').services['discord-bot']

    expect(discord).toMatchObject({
      build: { target: 'discord-bot' },
      profiles: ['discord'],
      read_only: true,
      init: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
      depends_on: { api: { condition: 'service_healthy' } },
      environment: { API_URL: 'http://api:3000', DISCORD_CLIENT_ID: '123456789012345678' },
    })
    expect(Object.keys(discord.networks ?? {}).sort()).toEqual(['application', 'observability'])
    expect(discord.secrets?.map(({ source }) => source).sort()).toEqual([
      'discord_internal_api_secret',
      'discord_token',
      'internal_api_secret',
      'metrics_scrape_secret',
      'otel_authorization',
    ])
    expect(discord.ports ?? []).toHaveLength(0)
  })

  test('keeps dead-letter provisioning and CLI operator-only', () => {
    const services = renderCompose('operator').services
    const role = services['dead-letter-role']
    const cli = services['dead-letter-cli']

    expect(role).toMatchObject({
      build: { target: 'dead-letter-role' },
      profiles: ['operator'],
      user: '70:70',
      restart: 'no',
      read_only: true,
      init: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
      depends_on: { migration: { condition: 'service_completed_successfully' } },
    })
    expect(Object.keys(role.networks ?? {})).toEqual(['application'])
    expect(role.secrets?.map(({ source }) => source).sort()).toEqual([
      'postgres_dead_letter_password',
      'postgres_owner_password',
    ])

    expect(cli).toMatchObject({
      build: { target: 'dead-letter-cli' },
      profiles: ['operator'],
      restart: 'no',
      read_only: true,
      init: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
      depends_on: { 'dead-letter-role': { condition: 'service_completed_successfully' } },
    })
    expect(Object.keys(cli.networks ?? {})).toEqual(['application'])
    expect(cli.secrets?.map(({ source }) => source).sort()).toEqual([
      'dead_letter_database_url',
      'dead_letter_operator_tokens',
    ])
    expect(cli.environment ?? {}).not.toHaveProperty('DEAD_LETTER_OPERATOR_TOKEN')
    expect(cli.ports ?? []).toHaveLength(0)
  })

  test('uses pinned images and excludes environment files from the build context', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8')
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8')
    const postgresInit = readFileSync(resolve(root, 'infra/app/postgres/10-runtime-role.sh'), 'utf8')

    expect(dockerfile).toContain('oven/bun:1.3.14@sha256:')
    expect(dockerfile).toContain('node:22.14.0-bookworm-slim@sha256:')
    expect(dockerfile).toContain('postgres:16.8-alpine@sha256:')
    expect(dockerfile).toContain('AS postgres')
    expect(dockerfile).toContain('AS web')
    expect(dockerfile).toContain('/app/packages/contracts/node_modules packages/contracts/node_modules')
    expect(dockerfile).toContain('apps/web/.next/standalone')
    expect(
      dockerfile.match(/org\.opencontainers\.image\.source="https:\/\/github\.com\/NickTacke\/brawltome"/g),
    ).toHaveLength(3)
    expect(dockerfile.match(/org\.opencontainers\.image\.revision=""/g)).toHaveLength(3)
    expect(dockerignore).toContain('**/.env*')
    expect(postgresInit).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
    expect(postgresInit).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE brawltome_owner')
    expect(postgresInit).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brawltome_runtime')
  })
})
