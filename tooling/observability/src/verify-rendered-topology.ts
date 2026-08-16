#!/usr/bin/env bun

import { posix } from 'node:path'

const approvedHost = 'observability.brawltome.app'

const expectedServiceNetworks: Record<string, string[]> = {
  alertmanager: ['notifications', 'observability'],
  'blackbox-exporter': ['application'],
  grafana: ['default', 'dokploy-network'],
  loki: ['observability'],
  'node-exporter': ['observability'],
  'otel-collector': ['application', 'observability'],
  prometheus: ['application', 'observability'],
  tempo: ['observability'],
}

const expectedImages: Record<string, string> = {
  alertmanager: 'prom/alertmanager:v0.28.1@sha256:27c475db5fb156cab31d5c18a4251ac7ed567746a2483ff264516437a39b15ba',
  'blackbox-exporter':
    'prom/blackbox-exporter:v0.27.0@sha256:a50c4c0eda297baa1678cd4dc4712a67fdea713b832d43ce7fcc5f9bea05094d',
  grafana: 'grafana/grafana-oss:12.1.1@sha256:a1701c2180249361737a99a01bc770db39381640e4d631825d38ff4535efa47d',
  loki: 'grafana/loki:3.5.3@sha256:3165cecce301ce5b9b6e3530284b080934a05cd5cafac3d3d82edcb887b45ecd',
  'node-exporter': 'prom/node-exporter:v1.9.1@sha256:d00a542e409ee618a4edc67da14dd48c5da66726bbd5537ab2af9c1dfc442c8a',
  'otel-collector':
    'otel/opentelemetry-collector-contrib:0.158.0@sha256:c5918f78992ee73b0d6f0e599423ac5ec52dd5d9726733114d6eca53d5a32ed5',
  prometheus: 'prom/prometheus:v3.5.0@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996',
  tempo: 'grafana/tempo:2.8.2@sha256:0ef775495967cd5d7a6b2e146b6ea695d624803c8db8349fb8ce4164f719f9b7',
}

const expectedUsers: Record<string, string> = {
  alertmanager: '65534:65534',
  'blackbox-exporter': '65534:65534',
  grafana: '472:472',
  loki: '10001:10001',
  'node-exporter': '65534:65534',
  'otel-collector': '10001:10001',
  prometheus: '65534:65534',
  tempo: '10001:10001',
}

const expectedServiceSecrets: Record<string, Array<{ source: string; target: string }>> = {
  alertmanager: [{ source: 'discord_webhook_url', target: '/run/secrets/discord_webhook_url' }],
  'blackbox-exporter': [],
  grafana: [{ source: 'grafana_admin_password', target: '/run/secrets/grafana_admin_password' }],
  loki: [],
  'node-exporter': [],
  'otel-collector': [{ source: 'otel_ingest_token', target: '/run/secrets/otel_ingest_token' }],
  prometheus: [{ source: 'metrics_scrape_secret', target: '/run/secrets/metrics_scrape_secret' }],
  tempo: [],
}

const expectedSecretFiles: Record<string, string> = {
  discord_webhook_url: '/var/lib/brawltome-observability-secrets/discord-webhook-url',
  grafana_admin_password: '/var/lib/brawltome-observability-secrets/grafana-admin-password',
  metrics_scrape_secret: '/var/lib/brawltome-observability-secrets/metrics-scrape-secret',
  otel_ingest_token: '/var/lib/brawltome-observability-secrets/otel-ingest-token',
}

export function verifyRenderedTopology(document: unknown, applicationNetworkName = 'brawltome-v3'): string[] {
  if (!isRecord(document)) return ['rendered Compose must be an object']

  const services = isRecord(document.services) ? document.services : {}
  const networks = isRecord(document.networks) ? document.networks : {}
  const secrets = isRecord(document.secrets) ? document.secrets : {}
  const violations: string[] = []

  checkExactKeys(violations, 'services', services, Object.keys(expectedServiceNetworks))
  checkExactKeys(violations, 'networks', networks, [
    'application',
    'default',
    'dokploy-network',
    'notifications',
    'observability',
  ])
  checkExactKeys(violations, 'secrets', secrets, Object.keys(expectedSecretFiles))

  for (const [name, expectedNetworks] of Object.entries(expectedServiceNetworks)) {
    const service = services[name]
    if (!isRecord(service)) {
      violations.push(`${name} must be a service object`)
      continue
    }

    if (!isRecord(service.networks) || !sameValues(Object.keys(service.networks), expectedNetworks)) {
      violations.push(`${name} networks must be exactly: ${expectedNetworks.join(', ')}`)
    }
    if (service.ports !== undefined && (!Array.isArray(service.ports) || service.ports.length > 0)) {
      violations.push(`${name} must not publish ports`)
    }
    if (service.image !== expectedImages[name]) violations.push(`${name} must use the approved pinned image`)
    if (service.user !== expectedUsers[name]) violations.push(`${name} must use the approved unprivileged user`)
    if (JSON.stringify(service.secrets ?? []) !== JSON.stringify(expectedServiceSecrets[name])) {
      violations.push(`${name} secrets must match the approved attachments exactly`)
    }
    checkSecretMountShadowing(
      violations,
      name,
      service,
      expectedServiceSecrets[name]?.map(({ target }) => target) ?? [],
    )

    const labels = service.labels
    if (labels !== undefined && !isStringRecord(labels)) {
      violations.push(`${name} labels must be a string map`)
    } else if (name !== 'grafana' && labels && traefikEntries(labels).length > 0) {
      violations.push(`${name} must not have Traefik labels`)
    }
  }

  checkNetwork(violations, networks, 'application', applicationNetworkName)
  checkNetwork(violations, networks, 'default', 'brawltome-observability')
  checkNetwork(violations, networks, 'dokploy-network', 'dokploy-network')
  checkNetwork(violations, networks, 'notifications', 'brawltome-notifications')
  checkNetwork(violations, networks, 'observability', 'brawltome-observability')
  for (const [key, file] of Object.entries(expectedSecretFiles)) checkSecret(violations, key, secrets[key], file)

  const grafana = services.grafana
  if (isRecord(grafana)) checkGrafana(violations, grafana)
  const nodeExporter = services['node-exporter']
  if (isRecord(nodeExporter)) checkNodeExporter(violations, nodeExporter)

  return violations
}

function checkNodeExporter(violations: string[], nodeExporter: Record<string, unknown>): void {
  const expectedCommand = [
    '--collector.disable-defaults',
    '--collector.filesystem',
    '--collector.filesystem.mount-points-include=^/storage/(prometheus|loki|tempo)$$',
    '--collector.textfile.directory=/textfile',
  ]
  if (
    !Array.isArray(nodeExporter.command) ||
    nodeExporter.command.some((value) => typeof value !== 'string') ||
    !sameValues(nodeExporter.command, expectedCommand)
  ) {
    violations.push('node-exporter command must match the approved collector set exactly')
  }
  const expectedVolumes = [
    ['/srv/brawltome-observability/prometheus', '/storage/prometheus'],
    ['/srv/brawltome-observability/loki', '/storage/loki'],
    ['/srv/brawltome-observability/tempo', '/storage/tempo'],
    ['/srv/brawltome-observability/backup-integrity', '/textfile'],
  ]
  const volumes = Array.isArray(nodeExporter.volumes) ? nodeExporter.volumes : []
  const volumesMatch =
    volumes.length === expectedVolumes.length &&
    expectedVolumes.every(([source, target]) =>
      volumes.some(
        (volume) =>
          isRecord(volume) &&
          volume.type === 'bind' &&
          volume.source === source &&
          volume.target === target &&
          volume.read_only === true,
      ),
    )
  if (!volumesMatch) {
    violations.push('node-exporter volumes must match the approved read-only host paths exactly')
  }
}

function checkGrafana(violations: string[], grafana: Record<string, unknown>): void {
  if (!isStringRecord(grafana.labels)) {
    violations.push('Grafana labels must be a string map')
  } else {
    const ruleKeys = Object.keys(grafana.labels).filter((key) => /^traefik\.http\.routers\..+-web\.rule$/.test(key))
    const match = ruleKeys.length === 1 ? ruleKeys[0]?.match(/^traefik\.http\.routers\.(.+)-web\.rule$/) : null
    if (!match) {
      violations.push('Grafana must have exactly one approved HTTP router')
    } else {
      const base = match[1]
      const expectedLabels = grafanaTraefikLabels(base)
      const actualLabels = Object.fromEntries(traefikEntries(grafana.labels))
      if (!sameStringRecords(actualLabels, expectedLabels)) {
        violations.push('Grafana Traefik labels must match the approved HTTPS route exactly')
      }
    }
  }

  if (!isStringRecord(grafana.environment)) {
    violations.push('Grafana environment must be a string map')
  } else {
    const expectedEnvironment = {
      GF_ANALYTICS_CHECK_FOR_UPDATES: 'false',
      GF_ANALYTICS_REPORTING_ENABLED: 'false',
      GF_AUTH_ANONYMOUS_ENABLED: 'false',
      GF_SECURITY_ADMIN_PASSWORD__FILE: '/run/secrets/grafana_admin_password',
      GF_SECURITY_COOKIE_SECURE: 'true',
      GF_SECURITY_DISABLE_GRAVATAR: 'true',
      GF_SERVER_ROOT_URL: `https://${approvedHost}`,
      GF_UNIFIED_ALERTING_ENABLED: 'false',
      GF_USERS_ALLOW_SIGN_UP: 'false',
    }
    if (!sameStringRecords(grafana.environment, expectedEnvironment)) {
      violations.push('Grafana environment must match the approved authentication configuration exactly')
    }
  }
}

function checkSecretMountShadowing(
  violations: string[],
  serviceName: string,
  service: Record<string, unknown>,
  secretTargets: string[],
): void {
  const mountTargets: string[] = []
  for (const field of ['volumes', 'configs'] as const) {
    const mounts = service[field]
    if (mounts === undefined) continue
    if (!Array.isArray(mounts) || mounts.some((mount) => !isRecord(mount) || typeof mount.target !== 'string')) {
      violations.push(`${serviceName} ${field} must be rendered mount objects`)
      continue
    }
    mountTargets.push(...mounts.map((mount) => String(mount.target)))
  }
  if (service.tmpfs !== undefined) {
    if (!Array.isArray(service.tmpfs) || service.tmpfs.some((mount) => typeof mount !== 'string')) {
      violations.push(`${serviceName} tmpfs must be rendered strings`)
    } else {
      mountTargets.push(...service.tmpfs.map((mount) => mount.split(':', 1)[0] ?? ''))
    }
  }
  if (mountTargets.some((mount) => secretTargets.some((secret) => shadowsPath(mount, secret)))) {
    violations.push(`${serviceName} mounts must not shadow approved secret targets`)
  }
}

function shadowsPath(mount: string, target: string): boolean {
  const normalizedMount = posix.normalize(mount)
  const normalizedTarget = posix.normalize(target)
  return (
    normalizedMount === '/' ||
    normalizedTarget === normalizedMount ||
    normalizedTarget.startsWith(`${normalizedMount}/`)
  )
}

function checkSecret(violations: string[], key: string, value: unknown, expectedFile: string): void {
  if (!isRecord(value) || value.file !== expectedFile || value.name !== `brawltome-observability_${key}`) {
    violations.push(`${key} must use the approved host secret file`)
  }
}

function grafanaTraefikLabels(base: string): Record<string, string> {
  const web = `${base}-web`
  const websecure = `${base}-websecure`
  return {
    'traefik.docker.network': 'dokploy-network',
    'traefik.enable': 'true',
    [`traefik.http.routers.${web}.entrypoints`]: 'web',
    [`traefik.http.routers.${web}.middlewares`]: 'redirect-to-https@file',
    [`traefik.http.routers.${web}.rule`]: `Host(\`${approvedHost}\`)`,
    [`traefik.http.routers.${web}.service`]: web,
    [`traefik.http.routers.${websecure}.entrypoints`]: 'websecure',
    [`traefik.http.routers.${websecure}.rule`]: `Host(\`${approvedHost}\`)`,
    [`traefik.http.routers.${websecure}.service`]: websecure,
    [`traefik.http.routers.${websecure}.tls.certresolver`]: 'letsencrypt',
    [`traefik.http.services.${web}.loadbalancer.server.port`]: '3000',
    [`traefik.http.services.${websecure}.loadbalancer.server.port`]: '3000',
  }
}

function checkExactKeys(
  violations: string[],
  subject: string,
  record: Record<string, unknown>,
  expectedKeys: string[],
): void {
  if (!sameValues(Object.keys(record), expectedKeys)) {
    violations.push(`${subject} must be exactly: ${[...expectedKeys].sort().join(', ')}`)
  }
}

function checkNetwork(
  violations: string[],
  networks: Record<string, unknown>,
  key: string,
  expectedName: string,
): void {
  const network = networks[key]
  if (!isRecord(network) || network.external !== true || network.name !== expectedName) {
    violations.push(`${key} must be external network ${expectedName}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function sameValues(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index])
}

function sameStringRecords(left: Record<string, string>, right: Record<string, string>): boolean {
  const keys = Object.keys(left)
  return sameValues(keys, Object.keys(right)) && keys.every((key) => left[key] === right[key])
}

function traefikEntries(labels: Record<string, string>): [string, string][] {
  return Object.entries(labels).filter(([key]) => key.toLowerCase().startsWith('traefik.'))
}

if (import.meta.main) {
  try {
    const document = JSON.parse(await Bun.stdin.text())
    const violations = verifyRenderedTopology(document, process.env.BRAWLTOME_NETWORK_NAME)
    for (const violation of violations) console.error(`rendered-topology: ${violation}`)
    if (violations.length > 0) process.exit(1)
    console.log('Rendered observability topology verified.')
  } catch {
    console.error('rendered-topology: input must be valid Docker Compose JSON')
    process.exit(1)
  }
}
