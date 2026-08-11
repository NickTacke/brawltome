import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  readBrawlhallaV1RequestLimit,
  readOperationsWorkerConfig,
  readSourceBackgroundHeadroom,
} from '../../../apps/api/src/operations-worker-config'

const root = resolve(import.meta.dir, '../../..')
const deployment = (...parts: string[]) => resolve(root, 'deploy/v3', ...parts)

function renderCompose() {
  const result = Bun.spawnSync({
    cmd: ['docker', 'compose', '--profile', 'discord', '-f', deployment('compose.yml'), 'config', '--format', 'json'],
    cwd: root,
    env: {
      ...process.env,
      V3_POSTGRES_DATA_ROOT: '/srv/brawltome-v3/postgres',
      V3_PUBLIC_API_URL: 'https://v3-api.brawltome.app',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return JSON.parse(result.stdout.toString()) as {
    networks: Record<string, { external?: boolean; name?: string }>
    secrets: Record<string, { file?: string; name?: string }>
    services: Record<
      string,
      {
        build?: { args?: Record<string, string>; target?: string }
        depends_on?: Record<string, { condition?: string }>
        deploy?: { replicas?: number; resources?: { limits?: { memory?: string; pids?: number } } }
        environment?: Record<string, string>
        healthcheck?: { test?: string[] }
        networks?: Record<string, unknown>
        ports?: unknown[]
        profiles?: string[]
        restart?: string
        secrets?: Array<{ source: string; target: string }>
        stop_grace_period?: string
        volumes?: Array<{ source?: string; target?: string; type?: string }>
      }
    >
  }
}

const runtimeServices = ['postgres', 'v3-api', 'v3-discord-bot', 'v3-operations-worker', 'v3-web'] as const

describe('V3 production topology', () => {
  test('renders independent one-replica units without public exposure', () => {
    const rendered = renderCompose()
    expect(Object.keys(rendered.services).sort()).toEqual([
      'migration',
      'postgres',
      'v3-api',
      'v3-discord-bot',
      'v3-operations-worker',
      'v3-web',
    ])

    for (const name of runtimeServices) {
      const service = rendered.services[name]
      expect(service.deploy?.replicas, `${name} replica count`).toBe(1)
      expect(service.deploy?.resources?.limits?.memory, `${name} memory limit`).toBeTruthy()
      expect(service.deploy?.resources?.limits?.pids, `${name} PID limit`).toBeGreaterThan(0)
      expect(service.ports ?? [], `${name} published ports`).toHaveLength(0)
    }

    expect(rendered.services['v3-discord-bot'].profiles).toEqual(['discord'])
    expect(JSON.stringify(rendered)).not.toContain('traefik')
    expect(JSON.stringify(rendered)).not.toContain('redis')
  })

  test('isolates data units and uses collision-free V3 runtime identities', () => {
    const rendered = renderCompose()
    const expected = {
      migration: ['application'],
      postgres: ['application'],
      'v3-api': ['application', 'observability'],
      'v3-discord-bot': ['application', 'observability'],
      'v3-operations-worker': ['application', 'observability'],
      'v3-web': ['application', 'observability'],
    }
    for (const [name, networks] of Object.entries(expected)) {
      expect(Object.keys(rendered.services[name].networks ?? {}).sort(), `${name} networks`).toEqual(networks)
    }
    expect(rendered.networks).toEqual({
      application: expect.objectContaining({ external: true, name: 'brawltome-v3' }),
      observability: expect.objectContaining({ external: true, name: 'brawltome-observability' }),
    })
  })

  test('gates runtimes on migration and preserves health and drain semantics', () => {
    const rendered = renderCompose()
    expect(rendered.services.migration.restart).toBe('no')
    expect(rendered.services['v3-api'].depends_on?.migration?.condition).toBe('service_completed_successfully')
    expect(rendered.services['v3-operations-worker'].depends_on?.migration?.condition).toBe(
      'service_completed_successfully',
    )
    expect(rendered.services['v3-web'].depends_on?.['v3-api']?.condition).toBe('service_healthy')

    expect(rendered.services['v3-api'].healthcheck?.test?.join(' ')).toContain('/health/ready')
    expect(rendered.services['v3-operations-worker'].healthcheck?.test?.join(' ')).toContain('/health/ready')
    expect(rendered.services['v3-web'].healthcheck?.test?.join(' ')).toContain('/api/health/ready')
    expect(rendered.services['v3-discord-bot'].healthcheck?.test?.join(' ')).toContain('/health/ready')
    for (const name of ['v3-api', 'v3-discord-bot', 'v3-operations-worker'] as const) {
      expect(rendered.services[name].stop_grace_period).toBe('1m10s')
    }
  })

  test('keeps secrets file-backed and bounds shared Brawlhalla quota', () => {
    const rendered = renderCompose()
    const expectedSecretFiles = {
      brawlhalla_api_key: 'brawlhalla-api-key',
      discord_internal_api_secret: 'discord-internal-api-secret',
      migration_database_url: 'migration-database-url',
      discord_token: 'discord-token',
      internal_api_secret: 'internal-api-secret',
      metrics_scrape_secret: 'metrics-scrape-secret',
      otel_authorization: 'otel-authorization',
      postgres_owner_password: 'postgres-owner-password',
      postgres_runtime_password: 'postgres-runtime-password',
      refresh_trust_cookie_secret: 'refresh-trust-cookie-secret',
      runtime_database_url: 'runtime-database-url',
    }
    expect(Object.keys(rendered.secrets).sort()).toEqual(Object.keys(expectedSecretFiles).sort())
    for (const [name, file] of Object.entries(expectedSecretFiles)) {
      expect(rendered.secrets[name]).toMatchObject({
        file: `/var/lib/brawltome-v3-secrets/${file}`,
        name: `brawltome-v3_${name}`,
      })
    }
    expect(rendered.services.migration.secrets?.map(({ source }) => source)).toEqual(['migration_database_url'])
    expect(rendered.services['v3-api'].secrets?.map(({ source }) => source)).toContain('runtime_database_url')
    expect(rendered.services['v3-api'].secrets?.map(({ source }) => source)).not.toContain('migration_database_url')
    expect(rendered.services['v3-operations-worker'].secrets?.map(({ source }) => source)).toContain(
      'runtime_database_url',
    )
    expect(rendered.services['v3-operations-worker'].secrets?.map(({ source }) => source)).not.toContain(
      'migration_database_url',
    )
    const workerEnvironment = rendered.services['v3-operations-worker'].environment
    expect(workerEnvironment).toMatchObject({
      BRAWLHALLA_V1_REQUEST_LIMIT: '102',
      OPERATIONS_INTERACTIVE_CONCURRENCY: '2',
      OPERATIONS_INTERACTIVE_RESERVATION: '1',
      OPERATIONS_LEADERBOARD_CONCURRENCY: '1',
      OPERATIONS_TOTAL_CONCURRENCY: '2',
      SOURCE_BACKGROUND_HEADROOM: '30',
    })
    expect(readOperationsWorkerConfig(workerEnvironment as NodeJS.ProcessEnv).admission).toMatchObject({
      totalConcurrency: 2,
      interactiveReservation: 1,
      classConcurrency: { interactive: 2, leaderboard: 1 },
    })
    expect(JSON.stringify(rendered.services)).not.toContain('DATABASE_URL=')
  })

  test('separates migration ownership from runtime data access', () => {
    const rendered = renderCompose()
    expect(rendered.services.postgres.build?.target).toBe('postgres')
    expect(rendered.services.postgres.environment).toMatchObject({ POSTGRES_USER: 'brawltome_owner' })
    expect(rendered.services.postgres.secrets?.map(({ source }) => source).sort()).toEqual([
      'postgres_owner_password',
      'postgres_runtime_password',
    ])
    expect(rendered.services.postgres.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '/srv/brawltome-v3/postgres',
          target: '/var/lib/postgresql/data',
          type: 'bind',
        }),
      ]),
    )
  })

  test('keeps the root Compose worker inside the approved source policy', () => {
    const result = Bun.spawnSync({
      cmd: [
        'docker',
        'compose',
        '--profile',
        'v3',
        '-f',
        resolve(root, 'docker-compose.yml'),
        'config',
        '--format',
        'json',
      ],
      cwd: root,
      env: {
        ...process.env,
        BRAWLHALLA_API_KEY: 'redacted-test-value',
        INTERNAL_API_SECRET: 'redacted-test-value',
        METRICS_SCRAPE_SECRET: 'redacted-test-value',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    const rendered = JSON.parse(result.stdout.toString()) as {
      services: { 'operations-worker': { environment: Record<string, string> } }
    }
    const environment = rendered.services['operations-worker'].environment
    const limit = readBrawlhallaV1RequestLimit(environment.BRAWLHALLA_V1_REQUEST_LIMIT)
    expect(limit).toBe(102)
    expect(readSourceBackgroundHeadroom(environment.SOURCE_BACKGROUND_HEADROOM, limit)).toBe(30)
  })

  test('uses pinned build/runtime images and excludes environment files from build context', () => {
    const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8')
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8')
    const postgresInit = readFileSync(deployment('postgres', '10-runtime-role.sh'), 'utf8')
    expect(dockerfile).toContain('oven/bun:1.3.14@sha256:')
    expect(dockerfile).toContain('node:22.14.0-bookworm-slim@sha256:')
    expect(dockerfile).toContain('postgres:16.8-alpine@sha256:')
    expect(dockerfile).toContain('AS postgres')
    expect(dockerfile).toContain('AS web')
    expect(dockerfile).toContain('/app/packages/contracts/node_modules packages/contracts/node_modules')
    expect(dockerfile).toContain('apps/web/.next/standalone')
    expect(dockerignore).toContain('**/.env*')
    expect(postgresInit).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS')
    expect(postgresInit).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE brawltome_owner')
    expect(postgresInit).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO brawltome_runtime')
  })
})
