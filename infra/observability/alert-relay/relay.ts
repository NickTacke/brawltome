import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DiscordClient, MessageBody } from './discord'
import { type Alert, pageMessage, renderBoard, resolvedEdit, resolvedNotice } from './render'

export type WebhookAlert = Alert & { status: 'firing' | 'resolved' }
export type WebhookPayload = { alerts?: WebhookAlert[] }
export type ApiAlert = Alert & { status: { state: 'active' | 'suppressed' | 'unprocessed' } }

export type PageRecord = { messageId: string; alert: Alert }

export type RelayState = {
  boardMessageId?: string
  boardFingerprint?: string
  boardEditedAt?: number
  clearSince?: number
  // Open critical pages by Alertmanager fingerprint.
  pages: Record<string, PageRecord>
  // Recently resolved fingerprints and when, so a late resolved webhook after a poll-side resolve stays quiet.
  resolved?: Record<string, number>
}

export type Logger = (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void

export interface StateStore {
  load(): RelayState
  save(state: RelayState): void
}

export class FileStateStore implements StateStore {
  private writeFailing = false

  constructor(
    private readonly path: string,
    private readonly log: Logger,
  ) {}

  load(): RelayState {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<RelayState>
      return { ...parsed, pages: parsed.pages ?? {} }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log('error', 'state file unreadable, starting empty', { error: String(error) })
      }
      return { pages: {} }
    }
  }

  // Atomic replace, so a crash mid-write never leaves a truncated file. A failed write is logged and the relay keeps
  // working from memory; the cost is a duplicate board or page after the next restart.
  save(state: RelayState): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp`
      writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 })
      renameSync(temporary, this.path)
      if (this.writeFailing) this.log('info', 'state file writable again')
      this.writeFailing = false
    } catch (error) {
      // Logged once per outage rather than on every board refresh.
      if (!this.writeFailing) {
        this.log('error', 'state file not writable; board and page ids will not survive a restart', {
          error: String(error),
        })
      }
      this.writeFailing = true
    }
  }
}

export type RelayConfig = {
  mention: string
  grafanaUrl: string
  // Re-edit an unchanged board this often so its "Updated" stamp proves the relay is alive.
  boardRefreshMs: number
  // A critical alert active in Alertmanager this long without a page gets paged by the poll (missed webhook).
  unnotifiedPageGraceMs: number
  // A paged alert must be absent from Alertmanager this long before the poll resolves it. Alertmanager keeps alerts
  // in memory, so this rides out its restarts until Prometheus re-sends.
  missingResolveGraceMs: number
}

export type RelayDeps = {
  discord: Pick<DiscordClient, 'post' | 'edit'>
  alertmanager: () => Promise<ApiAlert[]>
  store: StateStore
  config: RelayConfig
  now?: () => number
  log?: Logger
}

const isCritical = (alert: Alert) => alert.labels.severity === 'critical'
const isWatchdog = (alert: Alert) => alert.labels.alertname === 'Watchdog'

export class AlertRelay {
  private readonly state: RelayState
  private readonly now: () => number
  private readonly log: Logger
  private readonly missingSince = new Map<string, number>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: RelayDeps) {
    this.now = deps.now ?? Date.now
    this.log = deps.log ?? (() => {})
    this.state = deps.store.load()
  }

  snapshot(): RelayState {
    return structuredClone(this.state)
  }

  // Webhook path: page new critical alerts and resolve their messages immediately, then refresh the board. Throws if
  // a page could not be delivered so Alertmanager retries the notification.
  handleWebhook(payload: WebhookPayload): Promise<void> {
    return this.serialize(async () => {
      const failures: unknown[] = []
      for (const alert of payload.alerts ?? []) {
        if (!isCritical(alert) || !alert.fingerprint) continue
        try {
          if (alert.status === 'firing') await this.page(alert)
          else if (!this.isNewerEpisodeThan(alert)) await this.resolve(alert.fingerprint, alert, this.resolvedAt(alert))
        } catch (error) {
          failures.push(error)
          this.log('error', 'critical notification failed', {
            alertname: alert.labels.alertname,
            status: alert.status,
            error: String(error),
          })
        }
      }
      await this.refreshBoard().catch((error) => this.log('error', 'board refresh failed', { error: String(error) }))
      if (failures.length > 0) throw new Error(`${failures.length} critical notification(s) failed`)
    })
  }

  // Poll path: Alertmanager's API is the source of truth. Pages critical alerts that never reached us, resolves pages
  // whose alerts are gone, and redraws the board.
  sync(): Promise<void> {
    return this.serialize(async () => {
      const alerts = await this.deps.alertmanager()
      const now = this.now()
      const known = new Set(alerts.map((alert) => alert.fingerprint))

      for (const alert of alerts) {
        if (!isCritical(alert) || alert.status.state !== 'active') continue
        if (this.state.pages[alert.fingerprint]?.alert.startsAt === alert.startsAt) continue
        if (now - Date.parse(alert.startsAt) < this.deps.config.unnotifiedPageGraceMs) continue
        this.log('warn', 'paging a critical alert that arrived without a webhook', {
          alertname: alert.labels.alertname,
        })
        await this.page(alert).catch((error) =>
          this.log('error', 'critical page failed; retrying next poll', {
            alertname: alert.labels.alertname,
            error: String(error),
          }),
        )
      }

      for (const [fingerprint, record] of Object.entries(this.state.pages)) {
        if (known.has(fingerprint)) {
          this.missingSince.delete(fingerprint)
          continue
        }
        const since = this.missingSince.get(fingerprint) ?? now
        this.missingSince.set(fingerprint, since)
        if (now - since < this.deps.config.missingResolveGraceMs) continue
        await this.resolve(fingerprint, record.alert, since).catch((error) =>
          this.log('error', 'critical resolve failed; retrying next poll', {
            alertname: record.alert.labels.alertname,
            error: String(error),
          }),
        )
      }

      await this.drawBoard(alerts)
    })
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  private resolvedAt(alert: Alert): number {
    const endsAt = alert.endsAt ? Date.parse(alert.endsAt) : Number.NaN
    return Number.isFinite(endsAt) && endsAt > 0 && endsAt <= this.now() ? endsAt : this.now()
  }

  // A late resolved webhook for an earlier episode must not close the page of the episode that followed it.
  private isNewerEpisodeThan(alert: Alert): boolean {
    const record = this.state.pages[alert.fingerprint]
    return record !== undefined && Date.parse(record.alert.startsAt) > Date.parse(alert.startsAt)
  }

  private async page(alert: Alert): Promise<void> {
    const existing = this.state.pages[alert.fingerprint]
    if (existing?.alert.startsAt === alert.startsAt) return
    // The same series fired again after a resolution we never saw: close the old page, then page the new episode.
    if (existing) await this.resolve(alert.fingerprint, existing.alert, Date.parse(alert.startsAt))
    const messageId = await this.deps.discord.post(
      pageMessage(alert, this.deps.config.mention, this.deps.config.grafanaUrl),
    )
    this.state.pages[alert.fingerprint] = { messageId, alert: compact(alert) }
    if (this.state.resolved) delete this.state.resolved[alert.fingerprint]
    this.deps.store.save(this.state)
    this.log('info', 'paged critical alert', { alertname: alert.labels.alertname })
  }

  private async resolve(fingerprint: string, alert: Alert, resolvedAt: number): Promise<void> {
    const record = this.state.pages[fingerprint]
    if (record) {
      const edited = await this.deps.discord.edit(
        record.messageId,
        resolvedEdit(record.alert, resolvedAt, this.deps.config.grafanaUrl),
      )
      if (!edited) await this.deps.discord.post(resolvedNotice(record.alert, resolvedAt))
    } else if (this.state.resolved?.[fingerprint] === undefined) {
      await this.deps.discord.post(resolvedNotice(alert, resolvedAt))
    }
    delete this.state.pages[fingerprint]
    this.state.resolved = pruneResolved({ ...this.state.resolved, [fingerprint]: this.now() }, this.now())
    this.missingSince.delete(fingerprint)
    this.deps.store.save(this.state)
    this.log('info', 'resolved critical alert', { alertname: alert.labels.alertname })
  }

  private async refreshBoard(): Promise<void> {
    await this.drawBoard(await this.deps.alertmanager())
  }

  private async drawBoard(alerts: ApiAlert[]): Promise<void> {
    const now = this.now()
    const visible = alerts.filter(
      (alert) =>
        alert.status.state === 'active' &&
        !isWatchdog(alert) &&
        (alert.labels.severity === 'critical' || alert.labels.severity === 'warning'),
    )
    if (visible.length > 0) this.state.clearSince = undefined
    else this.state.clearSince ??= now

    const board = renderBoard({
      alerts: visible,
      watchdogFiring: alerts.some(isWatchdog),
      clearSince: this.state.clearSince,
      now,
    })
    const unchanged = board.fingerprint === this.state.boardFingerprint
    const fresh = now - (this.state.boardEditedAt ?? 0) < this.deps.config.boardRefreshMs
    if (this.state.boardMessageId && unchanged && fresh) return

    await this.publishBoard(board.body)
    this.state.boardFingerprint = board.fingerprint
    this.state.boardEditedAt = now
    this.deps.store.save(this.state)
  }

  private async publishBoard(body: MessageBody): Promise<void> {
    if (this.state.boardMessageId && (await this.deps.discord.edit(this.state.boardMessageId, body))) return
    if (this.state.boardMessageId) this.log('warn', 'status board message is gone, posting a new one')
    this.state.boardMessageId = await this.deps.discord.post(body)
    this.deps.store.save(this.state)
  }
}

const resolvedMemoryMs = 24 * 60 * 60 * 1_000

function pruneResolved(resolved: Record<string, number>, now: number): Record<string, number> {
  return Object.fromEntries(Object.entries(resolved).filter(([, at]) => now - at < resolvedMemoryMs))
}

// Keeps only what rendering a resolved page needs, so the state file stays small.
function compact(alert: Alert): Alert {
  return {
    fingerprint: alert.fingerprint,
    labels: alert.labels,
    annotations: alert.annotations,
    startsAt: alert.startsAt,
    ...(alert.generatorURL ? { generatorURL: alert.generatorURL } : {}),
  }
}
