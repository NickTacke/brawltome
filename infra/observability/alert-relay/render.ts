import { type Embed, type MessageBody, SUPPRESS_NOTIFICATIONS, noMentions, pageMentions } from './discord'

export type Alert = {
  fingerprint: string
  labels: Record<string, string>
  annotations: Record<string, string>
  startsAt: string
  endsAt?: string
  generatorURL?: string
}

const RED = 0xe5484d
const ORANGE = 0xf5a524
const GREEN = 0x30a46c

// Labels that tell an operator which part of the system broke. Everything else is either constant or noise.
const contextLabels = ['runtime', 'kind', 'work_class', 'failure_category', 'mountpoint', 'domain'] as const

const boardSectionLimit = 20

export function unixSeconds(iso: string | number): number {
  return Math.floor((typeof iso === 'number' ? iso : Date.parse(iso)) / 1_000)
}

export function relative(iso: string | number): string {
  return `<t:${unixSeconds(iso)}:R>`
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(Math.round(ms / 60_000), 0)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

function name(alert: Alert): string {
  return alert.labels.alertname ?? 'UnnamedAlert'
}

function summary(alert: Alert): string {
  return alert.annotations.summary ?? alert.annotations.description ?? 'no summary'
}

// Rewrites Prometheus' generatorURL (which points at an internal container host) into Grafana Explore on the public
// observability host, keeping the alert expression.
export function grafanaLink(grafanaUrl: string, generatorURL: string | undefined): string {
  const base = grafanaUrl.replace(/\/$/, '')
  let expr: string | null = null
  try {
    expr = generatorURL ? new URL(generatorURL).searchParams.get('g0.expr') : null
  } catch {}
  if (!expr) return base
  const panes = {
    a: {
      datasource: 'prometheus',
      queries: [{ refId: 'A', datasource: { type: 'prometheus', uid: 'prometheus' }, expr }],
      range: { from: 'now-6h', to: 'now' },
    },
  }
  const link = `${base}/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`
  // Discord rejects oversized URLs; very long expressions fall back to the Grafana home page.
  return link.length <= 1_800 ? link : base
}

function links(alert: Alert, grafanaUrl: string): string {
  const parts = [`[Grafana](${grafanaLink(grafanaUrl, alert.generatorURL)})`]
  if (alert.annotations.runbook_url) parts.push(`[Runbook](${alert.annotations.runbook_url})`)
  return truncate(parts.join(' · '), 1_024)
}

function labelFields(alert: Alert): Embed['fields'] {
  return contextLabels
    .filter((label) => alert.labels[label])
    .map((label) => ({ name: label, value: truncate(alert.labels[label] as string, 1_024), inline: true }))
}

// The content line is what a phone push notification shows, so it names the alert and what broke.
export function pageMessage(alert: Alert, mention: string, grafanaUrl: string): MessageBody {
  const headline = `🔴 **${name(alert)}**: ${summary(alert)}`
  return {
    content: truncate(mention ? `${mention} ${headline}` : headline, 2_000),
    embeds: [
      {
        title: truncate(`🔴 ${name(alert)}: ${summary(alert)}`, 256),
        url: grafanaLink(grafanaUrl, alert.generatorURL),
        ...(alert.annotations.description ? { description: truncate(alert.annotations.description, 4_000) } : {}),
        color: RED,
        fields: [
          { name: 'Started', value: relative(alert.startsAt), inline: true },
          ...(labelFields(alert) ?? []),
          { name: 'Links', value: links(alert, grafanaUrl) },
        ],
        timestamp: new Date(alert.startsAt).toISOString(),
      },
    ],
    allowed_mentions: pageMentions(mention),
  }
}

export function resolvedEdit(alert: Alert, resolvedAt: number, grafanaUrl: string): MessageBody {
  const duration = formatDuration(resolvedAt - Date.parse(alert.startsAt))
  return {
    content: truncate(`✅ **${name(alert)}** resolved after ${duration}: ${summary(alert)}`, 2_000),
    embeds: [
      {
        title: truncate(`✅ ${name(alert)}: ${summary(alert)}`, 256),
        url: grafanaLink(grafanaUrl, alert.generatorURL),
        description: truncate(
          [`Resolved after ${duration}.`, alert.annotations.description].filter(Boolean).join('\n\n'),
          4_000,
        ),
        color: GREEN,
        fields: [
          { name: 'Started', value: relative(alert.startsAt), inline: true },
          { name: 'Resolved', value: relative(resolvedAt), inline: true },
          ...(labelFields(alert) ?? []),
          { name: 'Links', value: links(alert, grafanaUrl) },
        ],
        timestamp: new Date(resolvedAt).toISOString(),
      },
    ],
    allowed_mentions: noMentions,
  }
}

// Used when the original page message is unknown (state lost): a short note that never pings.
export function resolvedNotice(alert: Alert, resolvedAt: number): MessageBody {
  const duration = formatDuration(resolvedAt - Date.parse(alert.startsAt))
  return {
    content: truncate(`✅ **${name(alert)}** resolved after ${duration}: ${summary(alert)}`, 2_000),
    allowed_mentions: noMentions,
    flags: SUPPRESS_NOTIFICATIONS,
  }
}

export type BoardInput = {
  alerts: Alert[]
  watchdogFiring: boolean
  clearSince: number | undefined
  now: number
}

function boardLines(alerts: Alert[]): string[] {
  const sorted = [...alerts].sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
  const lines = sorted
    .slice(0, boardSectionLimit)
    .map((alert) => truncate(`• **${name(alert)}** — ${summary(alert)} · since ${relative(alert.startsAt)}`, 300))
  if (sorted.length > boardSectionLimit) lines.push(`…and ${sorted.length - boardSectionLimit} more`)
  return lines
}

// Renders the status board. The "Updated" line is kept separate so callers can detect content changes without it.
export function renderBoard(input: BoardInput): { body: MessageBody; fingerprint: string } {
  const critical = input.alerts.filter((alert) => alert.labels.severity === 'critical')
  const warning = input.alerts.filter((alert) => alert.labels.severity === 'warning')

  const sections: string[] = []
  if (critical.length > 0) sections.push([`**🔴 Critical (${critical.length})**`, ...boardLines(critical)].join('\n'))
  if (warning.length > 0) sections.push([`**🟠 Warning (${warning.length})**`, ...boardLines(warning)].join('\n'))
  if (sections.length === 0) {
    sections.push(input.clearSince ? `✅ All clear since ${relative(input.clearSince)}` : '✅ All clear')
  }
  sections.push(
    input.watchdogFiring
      ? '📡 Prometheus → Alertmanager heartbeat OK'
      : '⚠️ No Prometheus heartbeat (Watchdog): rules may not be evaluated, so this board may be missing alerts',
  )

  const content = truncate(sections.join('\n\n'), 3_900)
  const color = critical.length > 0 ? RED : warning.length > 0 || !input.watchdogFiring ? ORANGE : GREEN
  const embed: Embed = { title: 'BrawlTome status', description: content, color }
  const fingerprint = JSON.stringify(embed)
  embed.description = `${content}\n\nUpdated ${relative(input.now)}`
  return {
    body: { embeds: [embed], allowed_mentions: noMentions, flags: SUPPRESS_NOTIFICATIONS },
    fingerprint,
  }
}
