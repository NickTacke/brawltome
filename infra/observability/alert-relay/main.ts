import { readFileSync } from 'node:fs'
import { DiscordClient } from './discord'
import { AlertRelay, type ApiAlert, FileStateStore, type Logger, type WebhookPayload } from './relay'

const env = (name: string, fallback: string) => process.env[name] ?? fallback
const duration = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of milliseconds`)
  return value
}

const log: Logger = (level, msg, fields) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })
  if (level === 'error') console.error(line)
  else console.log(line)
}

const webhookUrl = readFileSync(env('DISCORD_WEBHOOK_URL_FILE', '/run/secrets/discord_webhook_url'), 'utf8').trim()
if (!/^https?:\/\//.test(webhookUrl)) throw new Error('Discord webhook URL file does not contain a URL')

const alertmanagerUrl = env('ALERTMANAGER_URL', 'http://alertmanager:9093').replace(/\/$/, '')
const pollIntervalMs = duration('RELAY_POLL_INTERVAL_MS', 60_000)
const mention = env('DISCORD_PAGE_MENTION', '@everyone').trim()

const relay = new AlertRelay({
  discord: new DiscordClient({ webhookUrl, log }),
  alertmanager: async () => {
    const response = await fetch(`${alertmanagerUrl}/api/v2/alerts?active=true&silenced=true&inhibited=true`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Alertmanager API answered ${response.status}`)
    return (await response.json()) as ApiAlert[]
  },
  store: new FileStateStore(env('RELAY_STATE_FILE', '/state/state.json'), log),
  config: {
    mention: mention === 'none' ? '' : mention,
    grafanaUrl: env('GRAFANA_URL', 'https://observability.brawltome.app'),
    boardRefreshMs: duration('RELAY_BOARD_REFRESH_MS', 5 * 60_000),
    unnotifiedPageGraceMs: duration('RELAY_UNNOTIFIED_PAGE_GRACE_MS', 3 * 60_000),
    missingResolveGraceMs: duration('RELAY_MISSING_RESOLVE_GRACE_MS', 3 * 60_000),
  },
  log,
})

Bun.serve({
  port: Number(env('PORT', '8080')),
  maxRequestBodySize: 1024 * 1024,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === '/health') return new Response('ok')
    if (request.method === 'POST' && pathname === '/alertmanager') {
      let payload: WebhookPayload
      try {
        payload = (await request.json()) as WebhookPayload
      } catch {
        return new Response('invalid JSON', { status: 400 })
      }
      try {
        await relay.handleWebhook(payload)
        return new Response(null, { status: 204 })
      } catch {
        // Alertmanager retries failed webhooks, which retries the page.
        return new Response('delivery failed', { status: 503 })
      }
    }
    return new Response('not found', { status: 404 })
  },
})

const poll = () => relay.sync().catch((error) => log('error', 'alertmanager sync failed', { error: String(error) }))
setInterval(poll, pollIntervalMs)
void poll()
log('info', 'alert relay started', { pollIntervalMs, paging: mention ? 'mention' : 'no mention' })
