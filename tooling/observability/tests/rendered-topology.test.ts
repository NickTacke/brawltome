import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { verifyRenderedTopology } from '../src/verify-rendered-topology'

const verifier = resolve(import.meta.dir, '../src/verify-rendered-topology.ts')

type FixtureService = {
  configs?: Array<{ target: string }>
  environment?: Record<string, string>
  image: string
  labels?: Record<string, string>
  networks: Record<string, null>
  ports?: unknown[]
  secrets?: Array<{ source: string; target: string }>
  tmpfs?: string[]
  user: string
  volumes?: Array<{ target: string }>
}

type TopologyFixture = {
  networks: Record<string, { external: boolean; name: string }>
  secrets: Record<string, { file: string; name: string }>
  services: Record<string, FixtureService>
}

function validTopology(): TopologyFixture {
  const identities: Record<string, { image: string; user: string }> = {
    alertmanager: {
      image: 'prom/alertmanager:v0.28.1@sha256:27c475db5fb156cab31d5c18a4251ac7ed567746a2483ff264516437a39b15ba',
      user: '65534:65534',
    },
    'blackbox-exporter': {
      image: 'prom/blackbox-exporter:v0.27.0@sha256:a50c4c0eda297baa1678cd4dc4712a67fdea713b832d43ce7fcc5f9bea05094d',
      user: '65534:65534',
    },
    grafana: {
      image: 'grafana/grafana-oss:12.1.1@sha256:a1701c2180249361737a99a01bc770db39381640e4d631825d38ff4535efa47d',
      user: '472:472',
    },
    loki: {
      image: 'grafana/loki:3.5.3@sha256:3165cecce301ce5b9b6e3530284b080934a05cd5cafac3d3d82edcb887b45ecd',
      user: '10001:10001',
    },
    'node-exporter': {
      image: 'prom/node-exporter:v1.9.1@sha256:d00a542e409ee618a4edc67da14dd48c5da66726bbd5537ab2af9c1dfc442c8a',
      user: '65534:65534',
    },
    'otel-collector': {
      image:
        'otel/opentelemetry-collector-contrib:0.158.0@sha256:c5918f78992ee73b0d6f0e599423ac5ec52dd5d9726733114d6eca53d5a32ed5',
      user: '10001:10001',
    },
    prometheus: {
      image: 'prom/prometheus:v3.5.0@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996',
      user: '65534:65534',
    },
    tempo: {
      image: 'grafana/tempo:2.8.2@sha256:0ef775495967cd5d7a6b2e146b6ea695d624803c8db8349fb8ce4164f719f9b7',
      user: '10001:10001',
    },
  }
  const networks = {
    application: { external: true, name: 'brawltome-v3' },
    default: { external: true, name: 'brawltome-observability' },
    'dokploy-network': { external: true, name: 'dokploy-network' },
    notifications: { external: true, name: 'brawltome-notifications' },
    observability: { external: true, name: 'brawltome-observability' },
  }
  const service = (name: string, serviceNetworks: string[], secrets?: FixtureService['secrets']): FixtureService => {
    const identity = identities[name]
    if (!identity) throw new Error(`unknown fixture service: ${name}`)
    return {
      ...identity,
      networks: Object.fromEntries(serviceNetworks.map((network) => [network, null])),
      ...(secrets ? { secrets } : {}),
    }
  }

  return {
    networks,
    secrets: {
      discord_webhook_url: {
        file: '/var/lib/brawltome-observability-secrets/discord-webhook-url',
        name: 'brawltome-observability_discord_webhook_url',
      },
      grafana_admin_password: {
        file: '/var/lib/brawltome-observability-secrets/grafana-admin-password',
        name: 'brawltome-observability_grafana_admin_password',
      },
      metrics_scrape_secret: {
        file: '/var/lib/brawltome-observability-secrets/metrics-scrape-secret',
        name: 'brawltome-observability_metrics_scrape_secret',
      },
      otel_ingest_token: {
        file: '/var/lib/brawltome-observability-secrets/otel-ingest-token',
        name: 'brawltome-observability_otel_ingest_token',
      },
    },
    services: {
      alertmanager: service(
        'alertmanager',
        ['notifications', 'observability'],
        [{ source: 'discord_webhook_url', target: '/run/secrets/discord_webhook_url' }],
      ),
      'blackbox-exporter': service('blackbox-exporter', ['application']),
      grafana: {
        ...service('grafana', ['default', 'dokploy-network']),
        environment: {
          GF_ANALYTICS_CHECK_FOR_UPDATES: 'false',
          GF_ANALYTICS_REPORTING_ENABLED: 'false',
          GF_AUTH_ANONYMOUS_ENABLED: 'false',
          GF_SECURITY_ADMIN_PASSWORD__FILE: '/run/secrets/grafana_admin_password',
          GF_SECURITY_COOKIE_SECURE: 'true',
          GF_SECURITY_DISABLE_GRAVATAR: 'true',
          GF_SERVER_ROOT_URL: 'https://observability.brawltome.app',
          GF_UNIFIED_ALERTING_ENABLED: 'false',
          GF_USERS_ALLOW_SIGN_UP: 'false',
        },
        labels: {
          'traefik.docker.network': 'dokploy-network',
          'traefik.enable': 'true',
          'traefik.http.routers.observability-web.entrypoints': 'web',
          'traefik.http.routers.observability-web.middlewares': 'redirect-to-https@file',
          'traefik.http.routers.observability-web.rule': 'Host(`observability.brawltome.app`)',
          'traefik.http.routers.observability-web.service': 'observability-web',
          'traefik.http.routers.observability-websecure.entrypoints': 'websecure',
          'traefik.http.routers.observability-websecure.rule': 'Host(`observability.brawltome.app`)',
          'traefik.http.routers.observability-websecure.service': 'observability-websecure',
          'traefik.http.routers.observability-websecure.tls.certresolver': 'letsencrypt',
          'traefik.http.services.observability-web.loadbalancer.server.port': '3000',
          'traefik.http.services.observability-websecure.loadbalancer.server.port': '3000',
        },
        secrets: [{ source: 'grafana_admin_password', target: '/run/secrets/grafana_admin_password' }],
      },
      loki: service('loki', ['observability']),
      'node-exporter': service('node-exporter', ['observability']),
      'otel-collector': service(
        'otel-collector',
        ['application', 'observability'],
        [{ source: 'otel_ingest_token', target: '/run/secrets/otel_ingest_token' }],
      ),
      prometheus: service(
        'prometheus',
        ['application', 'observability'],
        [{ source: 'metrics_scrape_secret', target: '/run/secrets/metrics_scrape_secret' }],
      ),
      tempo: service('tempo', ['observability']),
    },
  }
}

describe('rendered Dokploy observability topology', () => {
  test('accepts the exact post-domain-injection topology', () => {
    expect(verifyRenderedTopology(validTopology())).toEqual([])
  })

  test('rejects exposure and network drift introduced after source rendering', () => {
    const topology = validTopology()
    topology.services.prometheus.networks.default = null
    topology.services.prometheus.labels = { 'traefik.enable': 'true' }
    topology.services.grafana.ports = [{ published: '3000', target: 3000 }]
    topology.networks.default.name = 'local-project-bridge'

    expect(verifyRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'prometheus networks must be exactly: application, observability',
        'prometheus must not have Traefik labels',
        'grafana must not publish ports',
        'default must be external network brawltome-observability',
      ]),
    )
  })

  test('rejects route, authentication, service, and application-network drift', () => {
    const topology = validTopology()
    const grafana = topology.services.grafana
    if (!grafana.labels || !grafana.environment) throw new Error('invalid test fixture')
    grafana.labels['traefik.docker.network'] = 'default'
    grafana.labels['traefik.http.routers.observability-web.rule'] = 'Host(`wrong.example`)'
    grafana.labels['traefik.http.services.observability-web.loadbalancer.server.port'] = '9090'
    grafana.environment.GF_SECURITY_COOKIE_SECURE = 'false'
    topology.services.extra = { image: 'extra', networks: {}, user: '0:0' }

    const violations = verifyRenderedTopology(topology, 'expected-application-network')
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('services must be exactly'),
        'application must be external network expected-application-network',
        'Grafana Traefik labels must match the approved HTTPS route exactly',
        'Grafana environment must match the approved authentication configuration exactly',
      ]),
    )
  })

  test('rejects malformed services, labels, ports, and extra networks', () => {
    const topology = validTopology() as unknown as Record<string, Record<string, unknown>>
    const services = topology.services as Record<string, unknown>
    const networks = topology.networks as Record<string, unknown>
    services.alertmanager = null
    ;(services.prometheus as Record<string, unknown>).labels = 'traefik.enable=true'
    ;(services.tempo as Record<string, unknown>).ports = {}
    networks.public = { external: true, name: 'public' }

    expect(verifyRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('networks must be exactly'),
        'alertmanager must be a service object',
        'prometheus labels must be a string map',
        'tempo must not publish ports',
      ]),
    )
  })

  test('rejects removed authentication and admin-secret protections', () => {
    const topology = validTopology()
    const grafana = topology.services.grafana
    if (!grafana.environment) throw new Error('invalid test fixture')
    Reflect.deleteProperty(grafana.environment, 'GF_AUTH_ANONYMOUS_ENABLED')
    Reflect.deleteProperty(grafana.environment, 'GF_USERS_ALLOW_SIGN_UP')
    grafana.environment.GF_AUTH_PROXY_ENABLED = 'true'
    grafana.secrets = []
    topology.secrets.grafana_admin_password.file = '/tmp/password'
    topology.secrets.extra = { file: '/tmp/extra', name: 'extra' }

    expect(verifyRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('secrets must be exactly'),
        'Grafana environment must match the approved authentication configuration exactly',
        'grafana secrets must match the approved attachments exactly',
        'grafana_admin_password must use the approved host secret file',
      ]),
    )
  })

  test('rejects image, user, and canonicalized secret-shadowing mount drift', () => {
    const topology = validTopology()
    topology.services.grafana.image = 'attacker/image:latest'
    topology.services.grafana.user = '0:0'
    topology.services.grafana.volumes = [{ target: '/tmp/../run' }]
    topology.services.prometheus.configs = [{ target: '/run/secrets/../secrets' }]
    topology.services.alertmanager.tmpfs = ['/run/./secrets:rw']

    expect(verifyRenderedTopology(topology)).toEqual(
      expect.arrayContaining([
        'grafana must use the approved pinned image',
        'grafana must use the approved unprivileged user',
        'grafana mounts must not shadow approved secret targets',
        'prometheus mounts must not shadow approved secret targets',
        'alertmanager mounts must not shadow approved secret targets',
      ]),
    )
  })

  test('rejects widened and case-variant Traefik routes', () => {
    const topology = validTopology()
    const labels = topology.services.grafana.labels
    if (!labels) throw new Error('invalid test fixture')
    labels['traefik.http.routers.observability-web.rule'] =
      'Host(`observability.brawltome.app`) || Host(`evil.example`)'
    labels['Traefik.http.routers.evil.rule'] = 'Host(`evil.example`)'

    expect(verifyRenderedTopology(topology)).toContain(
      'Grafana Traefik labels must match the approved HTTPS route exactly',
    )
  })

  test('exposes a failing stdin CLI for deployment gates', () => {
    const result = spawnSync('bun', [verifier], {
      input: JSON.stringify({ services: {} }),
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('rendered-topology: services must be exactly')
  })
})
