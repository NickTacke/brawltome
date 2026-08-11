import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

const root = resolve(import.meta.dir, '../../..')
const deploy = (...parts: string[]) => resolve(root, 'deploy/observability', ...parts)
const read = (...parts: string[]) => readFileSync(deploy(...parts), 'utf8')

const requiredAlerts = [
  'RuntimeMetricsTargetDown',
  'RuntimeNotReady',
  'WorkerHeartbeatStale',
  'OldestRunnableJobDelayed',
  'ScheduleMaterializationLate',
  'DeadLettersPresent',
  'SourceQuotaNearLimit',
  'RefreshFailuresElevated',
  'HttpLatencyHigh',
  'HttpErrorRateHigh',
  'TelemetryStorageNearQuota',
] as const

const persistentQuotas = {
  prometheus: 'OBSERVABILITY_METRICS_QUOTA_BYTES',
  loki: 'OBSERVABILITY_LOGS_QUOTA_BYTES',
  tempo: 'OBSERVABILITY_TRACES_QUOTA_BYTES',
} as const

function dashboard(name: string) {
  return JSON.parse(read('grafana', 'dashboards', `${name}.json`)) as {
    panels: Array<{ title: string; targets?: Array<{ expr?: string }> }>
  }
}

describe('observability deployment contract', () => {
  test('exposes fail-closed observability operator commands', () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.['observability:deploy']).toBe('bash deploy/observability/deploy-via-dokploy.sh')
    expect(packageJson.scripts?.['observability:network-preflight']).toBe('sh deploy/observability/networks/ensure.sh')
    expect(packageJson.scripts?.['observability:verify-rendered-topology']).toBe(
      'bun tooling/observability/src/verify-rendered-topology.ts',
    )
    expect(packageJson.scripts?.['observability:grafana-tunnel']).toBeUndefined()

    const deploymentScript = read('deploy-via-dokploy.sh')
    expect(deploymentScript).toContain('curl --silent --show-error --fail-with-body --config -')
    expect(deploymentScript).toContain('compose.getConvertedCompose')
    expect(deploymentScript.indexOf('observability:verify-rendered-topology')).toBeLessThan(
      deploymentScript.indexOf('api_post compose.deploy'),
    )
    expect(Bun.spawnSync(['bash', '-n', deploy('deploy-via-dokploy.sh')]).exitCode).toBe(0)
  })

  test('uses pinned dedicated services with resource and security limits', async () => {
    const compose = Bun.spawnSync({
      cmd: ['docker', 'compose', '-f', deploy('compose.yml'), 'config', '--format', 'json'],
      cwd: root,
      env: {
        ...process.env,
        OBSERVABILITY_DATA_ROOT: '/srv/brawltome-observability',
        OBSERVABILITY_METRICS_QUOTA_BYTES: '1000000000',
        OBSERVABILITY_LOGS_QUOTA_BYTES: '1000000000',
        OBSERVABILITY_TRACES_QUOTA_BYTES: '1000000000',
        PROMETHEUS_RETENTION_SIZE: '800MB',
        BRAWLTOME_NETWORK_NAME: 'brawltome-internal',
        DISCORD_WEBHOOK_URL_FILE: '/run/owner-secrets/discord-webhook-url',
        METRICS_SCRAPE_SECRET_FILE: '/run/owner-secrets/metrics-scrape-secret',
        OTEL_INGEST_TOKEN_FILE: '/run/owner-secrets/otel-ingest-token',
        GRAFANA_ADMIN_PASSWORD_FILE: '/run/owner-secrets/grafana-admin-password',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(compose.exitCode, compose.stderr.toString()).toBe(0)
    const rendered = JSON.parse(compose.stdout.toString()) as {
      networks?: Record<string, unknown>
      services: Record<
        string,
        {
          image?: string
          environment?: Record<string, string>
          deploy?: { resources?: { limits?: { cpus?: number; memory?: string; pids?: number } } }
          security_opt?: string[]
          ports?: Array<{
            host_ip?: string
            mode?: string
            protocol?: string
            published?: string
            target?: number
          }>
          networks?: Record<string, unknown>
        }
      >
    }
    const expected = [
      'alertmanager',
      'blackbox-exporter',
      'grafana',
      'loki',
      'node-exporter',
      'otel-collector',
      'prometheus',
      'tempo',
    ]
    const expectedNetworks: Record<string, string[]> = {
      alertmanager: ['notifications', 'observability'],
      'blackbox-exporter': ['application'],
      grafana: ['default', 'dokploy-network'],
      loki: ['observability'],
      'node-exporter': ['observability'],
      'otel-collector': ['application', 'observability'],
      prometheus: ['application', 'observability'],
      tempo: ['observability'],
    }

    expect(Object.keys(rendered.services).sort()).toEqual(expected)
    expect(JSON.stringify(rendered)).not.toContain('merlynx')
    for (const [name, service] of Object.entries(rendered.services)) {
      expect(service.image, `${name} image must be version-pinned`).toMatch(/:v?\d/)
      expect(service.deploy?.resources?.limits?.cpus, `${name} CPU limit`).toBeGreaterThan(0)
      expect(service.deploy?.resources?.limits?.memory, `${name} memory limit`).toBeTruthy()
      expect(service.deploy?.resources?.limits?.pids, `${name} PID limit`).toBeGreaterThan(0)
      expect(service.security_opt, `${name} no-new-privileges`).toContain('no-new-privileges:true')
      expect(service.ports ?? [], `${name} must not publish host ports`).toHaveLength(0)
      if (name === 'grafana') {
        expect(service.environment?.GF_SECURITY_COOKIE_SECURE).toBe('true')
        expect(service.environment?.GF_SERVER_ROOT_URL).toBe('https://observability.brawltome.app')
      }
      expect(Object.keys(service.networks ?? {}).sort(), `${name} network membership`).toEqual(expectedNetworks[name])
    }
    expect(rendered.networks).toMatchObject({
      application: { external: true, name: 'brawltome-internal' },
      default: { external: true, name: 'brawltome-observability' },
      'dokploy-network': { external: true, name: 'dokploy-network' },
      notifications: { external: true, name: 'brawltome-notifications' },
      observability: { external: true, name: 'brawltome-observability' },
    })
    for (const [name, service] of Object.entries(rendered.services)) {
      if (name !== 'grafana') expect(service.networks ?? {}).not.toHaveProperty('default')
    }
  })

  test('fixes retention and requires explicit quota-backed mounts', () => {
    const compose = read('compose.yml')
    const prometheus = read('prometheus', 'prometheus.yml')
    const loki = read('loki', 'loki.yml')
    const tempo = read('tempo', 'tempo.yml')

    expect(compose).toContain('--storage.tsdb.retention.time=30d')
    expect(compose).toContain('--storage.tsdb.retention.size=')
    expect(loki).toContain('retention_period: 336h')
    expect(tempo).toContain('block_retention: 168h')
    expect(prometheus).toContain('rules/alerts.yml')
    for (const [service, quota] of Object.entries(persistentQuotas)) {
      expect(compose).toContain(`${service}:`)
      expect(compose).toContain(quota)
    }
    expect(read('storage', 'verify-quota-mounts.sh')).toContain('findmnt')
  })

  test('scrapes V2 and V3 through distinct generation-labeled targets', () => {
    const config = parse(read('prometheus', 'prometheus.yml')) as {
      scrape_configs: Array<{
        job_name: string
        static_configs: Array<{ targets: string[]; labels?: Record<string, string> }>
      }>
    }
    const job = (name: string) => config.scrape_configs.find(({ job_name }) => job_name === name)?.static_configs

    expect(job('api')).toEqual([
      { targets: ['api:3000'], labels: { runtime: 'api', generation: 'v2' } },
      { targets: ['v3-api:3000'], labels: { runtime: 'api', generation: 'v3' } },
    ])
    expect(job('operations-worker')).toEqual([
      { targets: ['operations-worker:3001'], labels: { runtime: 'operations-worker', generation: 'v2' } },
      { targets: ['v3-operations-worker:3001'], labels: { runtime: 'operations-worker', generation: 'v3' } },
    ])
    expect(job('web')).toEqual([
      { targets: ['web:3000'], labels: { runtime: 'web', generation: 'v2' } },
      { targets: ['v3-web:3000'], labels: { runtime: 'web', generation: 'v3' } },
    ])
    expect(job('discord')).toEqual([
      { targets: ['discord-bot:3002'], labels: { runtime: 'discord', generation: 'v2' } },
    ])
    expect(job('readiness')).toEqual(
      expect.arrayContaining([
        { targets: ['http://api:3000/health/ready'], labels: { runtime: 'api', generation: 'v2' } },
        { targets: ['http://v3-api:3000/health/ready'], labels: { runtime: 'api', generation: 'v3' } },
        {
          targets: ['http://operations-worker:3001/health/ready'],
          labels: { runtime: 'operations-worker', generation: 'v2' },
        },
        {
          targets: ['http://v3-operations-worker:3001/health/ready'],
          labels: { runtime: 'operations-worker', generation: 'v3' },
        },
      ]),
    )
  })

  test('provisions every required low-cardinality alert and firing/recovery evidence', () => {
    const rules = read('prometheus', 'rules', 'alerts.yml')
    const evidence = read('prometheus', 'tests', 'alerts.test.yml')

    const declaredAlerts = Array.from(rules.matchAll(/^\s+- alert: (\S+)$/gm), ([, alert]) => alert)
    expect(declaredAlerts).toEqual([...requiredAlerts])
    for (const alert of requiredAlerts) expect(evidence).toContain(`alertname: ${alert}`)
    expect(rules).not.toMatch(/\b(request_id|trace_id|job_id|operation_id|user_id|guild_id)\b/)
    for (const aggregation of [
      'max by (runtime, generation)',
      'sum by (runtime, generation, le)',
      'sum by (runtime, generation)',
      'max by (generation, work_class)',
    ]) {
      expect(rules).toContain(aggregation)
    }
    expect(read('alertmanager', 'alertmanager.yml')).toContain('webhook_url_file: /run/secrets/discord_webhook_url')
    expect(read('alertmanager', 'alertmanager.yml')).toContain('send_resolved: true')
    expect(read('prometheus', 'prometheus.yml')).toContain('/run/secrets/metrics_scrape_secret')
    expect(read('prometheus', 'prometheus.yml')).not.toContain('internal_api_secret')
    expect(read('otel-collector', 'config.yml')).toContain('filename: /run/secrets/otel_ingest_token')
  })

  test('provisions dashboards for every issue-219 operational view', () => {
    const operations = dashboard('operations')
    const http = dashboard('http-health')
    const telemetry = dashboard('telemetry-storage')
    const titles = [...operations.panels, ...http.panels, ...telemetry.panels].map(({ title }) => title)
    const queries = [...operations.panels, ...http.panels, ...telemetry.panels]
      .flatMap(({ targets = [] }) => targets.map(({ expr = '' }) => expr))
      .join('\n')

    for (const title of [
      'Runtime readiness',
      'Worker heartbeat age',
      'Oldest runnable job',
      'Schedule lateness',
      'Dead letters',
      'Source quota use',
      'HTTP p95 latency',
      'HTTP 5xx rate',
    ]) {
      expect(titles).toContain(title)
    }
    expect(queries).toContain('generation')
    for (const metric of [
      'probe_success',
      'worker_heartbeat_timestamp_seconds',
      'operation_oldest_pending_age_ms',
      'schedule_lateness_ms',
      'operation_dead_letters',
      'source_quota_used',
      'http_server_duration_ms_bucket',
      'http_server_requests_total',
    ]) {
      expect(queries).toContain(metric)
    }
  })

  test('contains no persisted webhook, credentials, or high-cardinality Loki labels', () => {
    const files = [
      read('compose.yml'),
      read('alertmanager', 'alertmanager.yml'),
      read('otel-collector', 'config.yml'),
      read('loki', 'loki.yml'),
      read('prometheus', 'prometheus.yml'),
    ].join('\n')

    expect(files).not.toMatch(/discord(?:app)?\.com\/api\/webhooks/i)
    expect(files).not.toMatch(/(?:password|token|secret):\s*[A-Za-z0-9_-]{16,}/i)
    expect(files).not.toMatch(/(?:request|trace|span|job|operation|user|guild)[_.-]?id.*(?:label|index)/i)
  })
})
