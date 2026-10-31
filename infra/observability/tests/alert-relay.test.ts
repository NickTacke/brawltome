import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiscordClient, type MessageBody, SUPPRESS_NOTIFICATIONS, pageMentions } from '../alert-relay/discord'
import { AlertRelay, type ApiAlert, FileStateStore, type RelayState, type WebhookAlert } from '../alert-relay/relay'
import { formatDuration, grafanaLink, pageMessage, renderBoard } from '../alert-relay/render'

const grafana = 'https://observability.brawltome.app'
const runbook = 'https://github.com/NickTacke/brawltome/blob/master/docs/operations/alerts.md#httperrorratehigh'
const t0 = Date.parse('2026-10-31T12:00:00Z')

function alert(overrides: Partial<WebhookAlert> & { labels?: Record<string, string> } = {}): WebhookAlert {
  return {
    status: 'firing',
    fingerprint: 'fp-critical',
    startsAt: new Date(t0).toISOString(),
    endsAt: '0001-01-01T00:00:00Z',
    generatorURL: 'http://3f2a1b:9090/graph?g0.expr=rate%28x%5B5m%5D%29+%3E+1&g0.tab=1',
    annotations: {
      summary: 'api HTTP 5xx rate exceeds one percent',
      description: 'The fixed launch error boundary is breached.',
      runbook_url: runbook,
    },
    ...overrides,
    labels: { alertname: 'HttpErrorRateHigh', severity: 'critical', runtime: 'api', ...overrides.labels },
  }
}

const apiAlert = (source: WebhookAlert, state: ApiAlert['status']['state'] = 'active'): ApiAlert => {
  const { status: _status, ...rest } = source
  return { ...rest, status: { state } }
}

const watchdog = apiAlert(alert({ fingerprint: 'fp-watchdog', labels: { alertname: 'Watchdog', severity: 'none' } }))

class FakeDiscord {
  readonly calls: Array<{ op: 'post' | 'edit'; id?: string; body: MessageBody }> = []
  readonly messages = new Map<string, MessageBody>()
  failPosts = 0
  private next = 1

  async post(body: MessageBody): Promise<string> {
    this.calls.push({ op: 'post', body })
    if (this.failPosts > 0) {
      this.failPosts--
      throw new Error('Discord POST failed with 502')
    }
    const id = String(this.next++)
    this.messages.set(id, body)
    return id
  }

  async edit(id: string, body: MessageBody): Promise<boolean> {
    this.calls.push({ op: 'edit', id, body })
    if (!this.messages.has(id)) return false
    this.messages.set(id, body)
    return true
  }

  posts = () => this.calls.filter((call) => call.op === 'post')
  pages = () => this.posts().filter((call) => call.body.content?.includes('🔴'))
}

class MemoryStore {
  saved: RelayState | undefined
  constructor(private initial: RelayState = { pages: {} }) {}
  load = () => structuredClone(this.initial)
  save = (state: RelayState) => {
    this.saved = structuredClone(state)
  }
}

function setup(options: { initial?: RelayState; alerts?: ApiAlert[] } = {}) {
  const discord = new FakeDiscord()
  const store = new MemoryStore(options.initial)
  const clock = { now: t0 + 60_000 }
  const am = { alerts: options.alerts ?? [watchdog] }
  const relay = new AlertRelay({
    discord,
    alertmanager: async () => am.alerts,
    store,
    config: {
      mention: '<@123456789012345678>',
      grafanaUrl: grafana,
      boardRefreshMs: 300_000,
      unnotifiedPageGraceMs: 180_000,
      missingResolveGraceMs: 180_000,
    },
    now: () => clock.now,
  })
  return { relay, discord, store, clock, am }
}

describe('alert relay message mapping', () => {
  test('a page names the alert in the push text and links Grafana Explore and the runbook', () => {
    const body = pageMessage(alert(), '<@123456789012345678>', grafana)
    expect(body.content).toBe('<@123456789012345678> 🔴 **HttpErrorRateHigh**: api HTTP 5xx rate exceeds one percent')
    expect(body.allowed_mentions).toEqual({ parse: [], users: ['123456789012345678'] })
    const [embed] = body.embeds ?? []
    expect(embed?.title).toBe('🔴 HttpErrorRateHigh: api HTTP 5xx rate exceeds one percent')
    expect(embed?.color).toBe(0xe5484d)
    expect(embed?.fields).toContainEqual({ name: 'Started', value: `<t:${t0 / 1000}:R>`, inline: true })
    expect(embed?.fields).toContainEqual({ name: 'runtime', value: 'api', inline: true })
    expect(embed?.url).toStartWith(`${grafana}/explore?`)
    const links = embed?.fields?.find((field) => field.name === 'Links')?.value
    expect(links).toContain(`[Runbook](${runbook})`)
    expect(JSON.stringify(body)).not.toContain('3f2a1b')
  })

  test('Grafana Explore keeps the Prometheus expression and falls back to the home page', () => {
    const link = new URL(grafanaLink(grafana, 'http://3f2a1b:9090/graph?g0.expr=up+%3D%3D+0&g0.tab=1'))
    const panes = JSON.parse(link.searchParams.get('panes') ?? '{}')
    expect(link.origin).toBe(grafana)
    expect(panes.a.queries[0].expr).toBe('up == 0')
    expect(grafanaLink(`${grafana}/`, undefined)).toBe(grafana)
    expect(grafanaLink(grafana, 'not a url')).toBe(grafana)
    expect(grafanaLink(grafana, `http://x/graph?g0.expr=${'a'.repeat(3000)}`)).toBe(grafana)
  })

  test('mentions ping exactly what DISCORD_PAGE_MENTION names', () => {
    expect(pageMentions('@everyone')).toEqual({ parse: ['everyone'] })
    expect(pageMentions('@here')).toEqual({ parse: ['everyone'] })
    expect(pageMentions('<@&42>')).toEqual({ parse: [], roles: ['42'] })
    expect(pageMentions('<@!7> <@&42>')).toEqual({ parse: [], users: ['7'], roles: ['42'] })
    expect(pageMentions('')).toEqual({ parse: [] })
    expect(pageMessage(alert(), '', grafana).content).toStartWith('🔴 **HttpErrorRateHigh**')
  })

  test('durations read like a human wrote them', () => {
    expect(formatDuration(20_000)).toBe('under a minute')
    expect(formatDuration(12 * 60_000)).toBe('12m')
    expect(formatDuration(65 * 60_000)).toBe('1h 5m')
    expect(formatDuration(51 * 3_600_000)).toBe('2d 3h')
  })
})

describe('status board rendering', () => {
  test('all clear shows since when and the heartbeat', () => {
    const { body } = renderBoard({ alerts: [], watchdogFiring: true, clearSince: t0, now: t0 + 1_000 })
    const [embed] = body.embeds ?? []
    expect(embed?.color).toBe(0x30a46c)
    expect(embed?.description).toContain(`✅ All clear since <t:${t0 / 1000}:R>`)
    expect(embed?.description).toContain('heartbeat OK')
    expect(embed?.description).toEndWith(`Updated <t:${t0 / 1000 + 1}:R>`)
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.flags).toBe(SUPPRESS_NOTIFICATIONS)
  })

  test('lists critical before warning with summaries and start times', () => {
    const warning = alert({
      fingerprint: 'fp-warning',
      labels: { alertname: 'NewDeadLetters', severity: 'warning' },
      annotations: { summary: 'leaderboard-1v1 produced new dead letters' },
    })
    const { body } = renderBoard({ alerts: [warning, alert()], watchdogFiring: true, clearSince: undefined, now: t0 })
    const description = body.embeds?.[0]?.description ?? ''
    expect(body.embeds?.[0]?.color).toBe(0xe5484d)
    expect(description.indexOf('Critical (1)')).toBeLessThan(description.indexOf('Warning (1)'))
    expect(description).toContain(
      `• **NewDeadLetters** — leaderboard-1v1 produced new dead letters · since <t:${t0 / 1000}:R>`,
    )
    expect(description).not.toContain('All clear')
  })

  test('a missing watchdog is called out and long sections are truncated', () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      alert({ fingerprint: `fp-${index}`, labels: { alertname: `Warn${index}`, severity: 'warning' } }),
    )
    const { body } = renderBoard({ alerts: many, watchdogFiring: false, clearSince: undefined, now: t0 })
    const description = body.embeds?.[0]?.description ?? ''
    expect(description).toContain('No Prometheus heartbeat')
    expect(description).toContain('…and 5 more')
    expect(body.embeds?.[0]?.color).toBe(0xf5a524)
  })

  test('a board too busy for Discord keeps the heartbeat and an accurate omitted count', () => {
    const long = (prefix: string, severity: string, count: number) =>
      Array.from({ length: count }, (_, index) =>
        alert({
          fingerprint: `${prefix}-${index}`,
          labels: { alertname: `${prefix}${index}`, severity },
          annotations: { summary: 'x'.repeat(280) },
        }),
      )
    const alerts = [...long('Crit', 'critical', 18), ...long('Warn', 'warning', 18)]
    const { body } = renderBoard({ alerts, watchdogFiring: true, clearSince: undefined, now: t0 })
    const description = body.embeds?.[0]?.description ?? ''
    expect(description.length).toBeLessThanOrEqual(4_096)
    expect(description).toContain('heartbeat OK')
    expect(description).toContain('Warning (18)')
    const shown = (description.match(/^• /gm) ?? []).length
    const omitted = [...description.matchAll(/…and (\d+) more/g)].reduce((sum, match) => sum + Number(match[1]), 0)
    expect(shown).toBeGreaterThan(0)
    expect(shown + omitted).toBe(36)
  })

  test('the change fingerprint ignores the updated stamp', () => {
    const first = renderBoard({ alerts: [], watchdogFiring: true, clearSince: t0, now: t0 })
    const later = renderBoard({ alerts: [], watchdogFiring: true, clearSince: t0, now: t0 + 60_000 })
    expect(first.fingerprint).toBe(later.fingerprint)
    expect(first.body).not.toEqual(later.body)
  })
})

describe('edit versus post', () => {
  test('a critical alert pages once and its resolution edits the same message without a ping', async () => {
    const { relay, discord, clock, am } = setup()
    am.alerts = [watchdog, apiAlert(alert())]

    await relay.handleWebhook({ alerts: [alert()] })
    await relay.handleWebhook({ alerts: [alert()] })
    expect(discord.pages()).toHaveLength(1)
    const pageId = relay.snapshot().pages['fp-critical']?.messageId
    expect(pageId).toBeDefined()

    clock.now = t0 + 12 * 60_000
    am.alerts = [watchdog]
    await relay.handleWebhook({ alerts: [alert({ status: 'resolved', endsAt: new Date(clock.now).toISOString() })] })

    const resolution = discord.calls.find((call) => call.op === 'edit' && call.id === pageId)
    expect(resolution?.body.content).toBe(
      '✅ **HttpErrorRateHigh** resolved after 12m: api HTTP 5xx rate exceeds one percent',
    )
    expect(resolution?.body.allowed_mentions).toEqual({ parse: [] })
    expect(resolution?.body.embeds?.[0]?.color).toBe(0x30a46c)
    expect(resolution?.body.embeds?.[0]?.description).toStartWith('Resolved after 12m.')
    expect(relay.snapshot().pages).toEqual({})
    expect(discord.pages()).toHaveLength(1)
  })

  test('warnings never post a message of their own, only the board', async () => {
    const warning = alert({ fingerprint: 'fp-warning', labels: { alertname: 'NewDeadLetters', severity: 'warning' } })
    const { relay, discord, am } = setup()
    am.alerts = [watchdog, apiAlert(warning)]

    await relay.handleWebhook({ alerts: [warning] })
    await relay.handleWebhook({ alerts: [{ ...warning, status: 'resolved' }] })

    expect(discord.posts()).toHaveLength(1)
    expect(discord.posts()[0]?.body.embeds?.[0]?.title).toBe('BrawlTome status')
    expect(discord.messages.get('1')?.embeds?.[0]?.description).toContain('NewDeadLetters')
  })

  test('the board is posted once, then only edited when it changes or goes stale', async () => {
    const { relay, discord, clock, am } = setup()
    await relay.sync()
    await relay.sync()
    expect(discord.calls.map((call) => call.op)).toEqual(['post'])

    am.alerts = [watchdog, apiAlert(alert({ labels: { severity: 'warning' } }))]
    await relay.sync()
    expect(discord.calls.at(-1)).toMatchObject({ op: 'edit', id: '1' })

    const before = discord.calls.length
    clock.now += 60_000
    await relay.sync()
    expect(discord.calls.length).toBe(before)
    clock.now += 300_000
    await relay.sync()
    expect(discord.calls.length).toBe(before + 1)
    expect(discord.posts()).toHaveLength(1)
  })

  test('a deleted board message is replaced by a new post', async () => {
    const { relay, discord } = setup({ initial: { pages: {}, boardMessageId: '999' } })
    await relay.sync()
    expect(discord.calls.map((call) => call.op)).toEqual(['edit', 'post'])
    expect(relay.snapshot().boardMessageId).toBe('1')
  })

  test('after a restart the persisted board and page are edited, not re-posted', async () => {
    const first = setup()
    first.am.alerts = [watchdog, apiAlert(alert())]
    await first.relay.handleWebhook({ alerts: [alert()] })
    const persisted = first.store.saved as RelayState

    const second = setup({ initial: persisted, alerts: [watchdog, apiAlert(alert())] })
    for (const [id, body] of first.discord.messages) second.discord.messages.set(id, body)
    await second.relay.handleWebhook({ alerts: [alert()] })
    second.clock.now += 400_000
    await second.relay.sync()
    second.am.alerts = [watchdog]
    await second.relay.handleWebhook({ alerts: [alert({ status: 'resolved' })] })

    expect(second.discord.posts()).toHaveLength(0)
    expect(second.discord.calls.filter((call) => call.op === 'edit').map((call) => call.id)).toContain(
      persisted.pages['fp-critical']?.messageId,
    )
  })

  test('a new episode of a paged alert pages again even when its resolution was missed', async () => {
    const { relay, discord, clock, am } = setup()
    am.alerts = [watchdog, apiAlert(alert())]
    await relay.handleWebhook({ alerts: [alert()] })
    const firstPage = relay.snapshot().pages['fp-critical']?.messageId

    clock.now = t0 + 10 * 60_000
    const second = alert({ startsAt: new Date(t0 + 9 * 60_000).toISOString() })
    am.alerts = [watchdog, apiAlert(second)]
    await relay.sync()
    clock.now += 180_000
    await relay.sync()

    expect(discord.pages()).toHaveLength(2)
    expect(discord.calls.find((call) => call.op === 'edit' && call.id === firstPage)?.body.content).toStartWith('✅')
    const secondPage = relay.snapshot().pages['fp-critical']
    expect(secondPage?.alert.startsAt).toBe(second.startsAt)

    // The first episode's resolution arriving late must not close the second page.
    await relay.handleWebhook({ alerts: [alert({ status: 'resolved' })] })
    expect(relay.snapshot().pages['fp-critical']?.messageId).toBe(secondPage?.messageId)
  })

  test('a resolution for an unknown page posts a short notice that does not notify', async () => {
    const { relay, discord } = setup()
    await relay.handleWebhook({ alerts: [alert({ status: 'resolved' })] })
    const notice = discord.posts().find((call) => call.body.content?.startsWith('✅'))
    expect(notice?.body.allowed_mentions).toEqual({ parse: [] })
    expect(notice?.body.flags).toBe(SUPPRESS_NOTIFICATIONS)
    expect(notice?.body.content).not.toContain('<@')
  })

  test('the poll resolves pages whose alert vanished, and a late resolved webhook stays quiet', async () => {
    const { relay, discord, clock, am } = setup()
    am.alerts = [watchdog, apiAlert(alert())]
    await relay.handleWebhook({ alerts: [alert()] })

    am.alerts = [watchdog]
    clock.now += 60_000
    await relay.sync()
    expect(relay.snapshot().pages['fp-critical']).toBeDefined()
    clock.now += 180_000
    await relay.sync()
    expect(relay.snapshot().pages).toEqual({})
    expect(discord.calls.some((call) => call.op === 'edit' && call.body.content?.startsWith('✅'))).toBe(true)

    const posts = discord.posts().length
    await relay.handleWebhook({ alerts: [alert({ status: 'resolved' })] })
    expect(discord.posts()).toHaveLength(posts)
  })

  test('a failed page is reported to Alertmanager and retried by the poll', async () => {
    const { relay, discord, clock, am } = setup()
    am.alerts = [watchdog, apiAlert(alert())]
    discord.failPosts = 1
    await expect(relay.handleWebhook({ alerts: [alert()] })).rejects.toThrow('1 critical notification(s) failed')
    expect(relay.snapshot().pages).toEqual({})

    clock.now = t0 + 200_000
    await relay.sync()
    expect(discord.pages()).toHaveLength(2)
    expect(relay.snapshot().pages['fp-critical']).toBeDefined()
  })

  test('silenced criticals neither page from the poll nor show on the board', async () => {
    const { relay, discord, clock } = setup({ alerts: [watchdog, apiAlert(alert(), 'suppressed')] })
    clock.now = t0 + 600_000
    await relay.sync()
    expect(discord.pages()).toHaveLength(0)
    expect(discord.messages.get('1')?.embeds?.[0]?.description).toContain('All clear')
  })
})

describe('Discord client', () => {
  const ok = (id: string) => Response.json({ id })

  test('waits out a 429 using retry_after and posts with wait=true', async () => {
    const requests: Array<{ url: string; method?: string }> = []
    const sleeps: number[] = []
    const responses = [Response.json({ retry_after: 1.5, global: false }, { status: 429 }), ok('77')]
    const client = new DiscordClient({
      webhookUrl: 'https://discord.test/api/webhooks/1/secret-token',
      fetch: (async (url: URL, init: RequestInit) => {
        requests.push({ url: String(url), method: init.method })
        return responses.shift() as Response
      }) as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(await client.post({ content: 'x', allowed_mentions: { parse: [] } })).toBe('77')
    expect(sleeps).toEqual([1_600])
    expect(requests.map((request) => request.url)).toEqual([
      'https://discord.test/api/webhooks/1/secret-token?wait=true',
      'https://discord.test/api/webhooks/1/secret-token?wait=true',
    ])
  })

  test('falls back to the Retry-After header, retries 5xx with backoff, and edits by message id', async () => {
    const requests: Array<{ url: string; method?: string; body: string }> = []
    const sleeps: number[] = []
    const responses = [
      new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
      new Response('bad gateway', { status: 502 }),
      ok('5'),
    ]
    const client = new DiscordClient({
      webhookUrl: 'https://discord.test/api/webhooks/1/secret-token',
      fetch: (async (url: URL, init: RequestInit) => {
        requests.push({ url: String(url), method: init.method, body: String(init.body) })
        return responses.shift() as Response
      }) as unknown as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(await client.edit('5', { content: 'y', allowed_mentions: { parse: [] }, flags: 4096 })).toBe(true)
    expect(sleeps).toEqual([2_100, 1_000])
    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      url: 'https://discord.test/api/webhooks/1/secret-token/messages/5',
    })
    expect(JSON.parse(requests[0]?.body ?? '{}')).not.toHaveProperty('flags')
  })

  test('reports a missing message on edit and gives up on persistent failures without leaking the token', async () => {
    const client = (status: number) =>
      new DiscordClient({
        webhookUrl: 'https://discord.test/api/webhooks/1/secret-token',
        fetch: (async () => new Response('{}', { status })) as unknown as typeof fetch,
        sleep: async () => {},
      })
    expect(await client(404).edit('1', { allowed_mentions: { parse: [] } })).toBe(false)
    const failure = client(503)
      .post({ allowed_mentions: { parse: [] } })
      .catch((error: Error) => error)
    const error = await failure
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain('503')
    expect(String(error)).not.toContain('secret-token')
  })
})

describe('state file', () => {
  test('round-trips atomically and tolerates a missing or corrupt file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'alert-relay-'))
    const path = join(directory, 'nested', 'state.json')
    const logs: string[] = []
    const store = new FileStateStore(path, (level, msg) => logs.push(`${level}:${msg}`))
    expect(store.load()).toEqual({ pages: {} })
    store.save({ pages: {}, boardMessageId: '9' })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ pages: {}, boardMessageId: '9' })
    writeFileSync(path, '{not json')
    expect(store.load()).toEqual({ pages: {} })
    expect(logs).toEqual(['error:state file unreadable, starting empty'])
  })
})
