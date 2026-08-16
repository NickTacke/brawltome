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
        deploy?: { replicas?: number; resources?: { limits?: { memory?: string; pids?: number } } }
        environment?: Record<string, string>
        healthcheck?: { test?: string[] }
        init?: boolean
        networks?: Record<string, unknown>
        ports?: unknown[]
        profiles?: string[]
        read_only?: boolean
        restart?: string
        secrets?: Array<{ source: string; target?: string }>
        security_opt?: string[]
        stop_grace_period?: string
        user?: string
      }
    >
    secrets: Record<string, { file?: string; name?: string }>
  }
}

describe('application profile topology', () => {
  test('keeps Discord internal, hardened, and dependent on API readiness', () => {
    const rendered = renderCompose('discord')
    const discord = rendered.services['discord-bot']

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
    expect(discord.healthcheck?.test?.join(' ')).toContain('http://localhost:3002/health/ready')
    expect(discord.stop_grace_period).toBe('1m10s')
    expect(discord.deploy).toMatchObject({
      replicas: 1,
      resources: { limits: { memory: '536870912', pids: 192 } },
    })
    expect(discord.secrets?.toSorted((left, right) => left.source.localeCompare(right.source))).toEqual([
      {
        source: 'discord_internal_api_secret',
        target: '/run/secrets/discord_internal_api_secret',
      },
      { source: 'discord_token', target: '/run/secrets/discord_token' },
      { source: 'internal_api_secret', target: '/run/secrets/internal_api_secret' },
      { source: 'metrics_scrape_secret', target: '/run/secrets/metrics_scrape_secret' },
      { source: 'otel_authorization', target: '/run/secrets/otel_authorization' },
    ])
    expect(rendered.secrets.discord_token).toEqual({
      file: '/var/lib/brawltome-secrets/discord-token',
      name: 'brawltome_discord_token',
    })
    expect(discord.ports ?? []).toHaveLength(0)
  })

  test('keeps dead-letter provisioning and CLI operator-only', () => {
    const rendered = renderCompose('operator')
    const services = rendered.services
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
    expect(role.deploy).toMatchObject({ resources: { limits: { memory: '134217728', pids: 64 } } })
    expect(role.secrets?.toSorted((left, right) => left.source.localeCompare(right.source))).toEqual([
      {
        source: 'postgres_dead_letter_password',
        target: '/run/secrets/postgres_dead_letter_password',
      },
      { source: 'postgres_owner_password', target: '/run/secrets/postgres_owner_password' },
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
    expect(cli.deploy).toMatchObject({ resources: { limits: { memory: '134217728', pids: 64 } } })
    expect(cli.secrets?.toSorted((left, right) => left.source.localeCompare(right.source))).toEqual([
      { source: 'dead_letter_database_url', target: '/run/secrets/dead_letter_database_url' },
      {
        source: 'dead_letter_operator_tokens',
        target: '/run/secrets/dead_letter_operator_tokens',
      },
    ])
    expect(services).not.toHaveProperty('discord-bot')
    expect(rendered.secrets).toMatchObject({
      dead_letter_database_url: {
        file: '/var/lib/brawltome-secrets/dead-letter-database-url',
        name: 'brawltome_dead_letter_database_url',
      },
      dead_letter_operator_tokens: {
        file: '/var/lib/brawltome-secrets/dead-letter-operator-tokens',
        name: 'brawltome_dead_letter_operator_tokens',
      },
      postgres_dead_letter_password: {
        file: '/var/lib/brawltome-secrets/postgres-dead-letter-password',
        name: 'brawltome_postgres_dead_letter_password',
      },
    })
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
