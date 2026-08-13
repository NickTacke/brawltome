import { createHash } from 'node:crypto'
import type {
  ActorAdmissionResult,
  AdmissionActor,
  SourceAdmissionResult,
  SourceCaller,
  SourceDomain,
  SourceQuotaUsage,
} from '@brawltome/request-admission'
import postgres from 'postgres'

const defaultWindowSeconds = 15 * 60
const defaultActorReservationRetentionSeconds = 24 * 60 * 60

type RequestAdmissionConfig = {
  authenticatedIpLimit: number
  sourceLimits: Record<string, number>
  sourceWindowSeconds?: Record<string, number>
  sourceBackgroundHeadroom?: number
  minimumSourceSpacingMs?: number
  actorReservationRetentionSeconds?: number
  windowSeconds?: number
  afterWindowCaptured?: (capturedAt: Date) => Promise<void>
}

type Counter = { units: number }
type ActorCounter = Counter & { window_started_at: Date }
type DatabaseTime = { now: Date }
type SourceReservation = { admitted_at: Date; units: number }
type SourceState = { last_admitted_at: Date | null; paused_until: Date }

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function actorDimensions(actor: AdmissionActor, authenticatedIpLimit: number) {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  switch (actor.kind) {
    case 'verified-anonymous':
      return [{ domain: 'anonymous-refresh', key: hash(actor.ip), limit: 20 }]
    case 'authenticated':
      return [
        { domain: 'authenticated-account-refresh', key: hash(actor.accountId), limit: 60 },
        { domain: 'authenticated-ip-refresh', key: hash(actor.ip), limit: authenticatedIpLimit },
      ]
    case 'discord':
      return [{ domain: 'discord-refresh', key: hash(actor.discordUserId), limit: 20 }]
    case 'desktop':
      return [{ domain: 'desktop-ranked-refresh', key: hash(actor.ip), limit: 60 }]
    case 'matchmaking-ingest':
      return [{ domain: 'matchmaking-ingest', key: hash(actor.accountId), limit: 60 }]
  }
}

export function createPostgresRequestAdmission(connectionString: string, config: RequestAdmissionConfig) {
  const authenticatedIpLimit = positiveInteger('authenticatedIpLimit', config.authenticatedIpLimit)
  const windowSeconds = positiveInteger('windowSeconds', config.windowSeconds ?? defaultWindowSeconds)
  const sourceBackgroundHeadroom = config.sourceBackgroundHeadroom ?? 0
  if (!Number.isInteger(sourceBackgroundHeadroom) || sourceBackgroundHeadroom < 0) {
    throw new Error('sourceBackgroundHeadroom must be a non-negative integer')
  }
  const minimumSourceSpacingMs = config.minimumSourceSpacingMs ?? 0
  if (!Number.isFinite(minimumSourceSpacingMs) || minimumSourceSpacingMs < 0) {
    throw new Error('minimumSourceSpacingMs must be a finite number >= 0')
  }
  const actorReservationRetentionSeconds = positiveInteger(
    'actorReservationRetentionSeconds',
    config.actorReservationRetentionSeconds ?? defaultActorReservationRetentionSeconds,
  )
  const sourceLimits = Object.fromEntries(
    Object.entries(config.sourceLimits).map(([domain, limit]) => [domain, positiveInteger(`${domain} limit`, limit)]),
  ) as Record<string, number>
  const sourceWindowSeconds = Object.fromEntries(
    Object.entries(config.sourceWindowSeconds ?? {}).map(([domain, seconds]) => [
      domain,
      positiveInteger(`${domain} window seconds`, seconds),
    ]),
  ) as Record<string, number>
  const client = postgres(connectionString)

  async function captureWindow(sql: typeof client, durationSeconds = windowSeconds) {
    const [databaseTime] = await sql<DatabaseTime[]>`SELECT clock_timestamp() AS now`
    await config.afterWindowCaptured?.(databaseTime.now)
    const windowStartedAt = new Date(
      Math.floor(databaseTime.now.getTime() / (durationSeconds * 1_000)) * durationSeconds * 1_000,
    )
    return { now: databaseTime.now, windowStartedAt }
  }

  function retryAfterSeconds(now: Date, windowStartedAt: Date): number {
    return Math.max(1, Math.ceil((windowStartedAt.getTime() + windowSeconds * 1_000 - now.getTime()) / 1_000))
  }

  async function admitActor(actor: AdmissionActor, reservationKey: string): Promise<ActorAdmissionResult> {
    const dimensions = actorDimensions(actor, authenticatedIpLimit).sort((left, right) =>
      `${left.domain}:${left.key}`.localeCompare(`${right.domain}:${right.key}`),
    )
    return client.begin(async (transaction) => {
      const sql = transaction as unknown as typeof client
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`actor:${reservationKey}`}, 0))`
      const [existing] = await sql<{ reservation_key: string }[]>`
        SELECT reservation_key FROM request_admission.actor_reservations
        WHERE reservation_key = ${reservationKey}
      `
      if (existing) return { outcome: 'admitted' as const }

      const window = await captureWindow(sql)
      const reservationCutoff = new Date(window.now.getTime() - actorReservationRetentionSeconds * 1_000)
      await sql`
        DELETE FROM request_admission.actor_reservations
        WHERE admitted_at <= ${reservationCutoff}
      `
      for (const dimension of dimensions) {
        await sql`
          DELETE FROM request_admission.actor_windows
          WHERE domain = ${dimension.domain} AND actor_key = ${dimension.key}
            AND window_started_at < ${window.windowStartedAt}
        `
        await sql`
          INSERT INTO request_admission.actor_windows (domain, actor_key, window_started_at, units)
          VALUES (${dimension.domain}, ${dimension.key}, ${window.windowStartedAt}, 0)
          ON CONFLICT DO NOTHING
        `
      }
      const rows: Counter[] = []
      for (const dimension of dimensions) {
        const [row] = await sql<Counter[]>`
          SELECT units FROM request_admission.actor_windows
          WHERE domain = ${dimension.domain} AND actor_key = ${dimension.key}
            AND window_started_at = ${window.windowStartedAt}
          FOR UPDATE
        `
        rows.push(row)
      }
      const rejected = dimensions.find((dimension, index) => rows[index].units + 1 > dimension.limit)
      if (rejected) {
        return {
          outcome: 'rate-limited' as const,
          retryAfterSeconds: retryAfterSeconds(window.now, window.windowStartedAt),
        }
      }
      for (const dimension of dimensions) {
        await sql`
          UPDATE request_admission.actor_windows SET units = units + 1
          WHERE domain = ${dimension.domain} AND actor_key = ${dimension.key}
            AND window_started_at = ${window.windowStartedAt}
        `
      }
      await sql`
        INSERT INTO request_admission.actor_reservations (reservation_key)
        VALUES (${reservationKey})
      `
      return { outcome: 'admitted' as const }
    })
  }

  async function admitActorOnce(actor: AdmissionActor): Promise<ActorAdmissionResult> {
    const dimensions = actorDimensions(actor, authenticatedIpLimit).sort((left, right) =>
      `${left.domain}:${left.key}`.localeCompare(`${right.domain}:${right.key}`),
    )
    return client.begin(async (transaction) => {
      const sql = transaction as unknown as typeof client
      for (const dimension of dimensions) {
        await sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`actor-dimension:${dimension.domain}:${dimension.key}`}, 0)
          )
        `
      }
      const window = await captureWindow(sql)
      const activeAfter = new Date(window.now.getTime() - windowSeconds * 1_000)
      const reservationCutoff = new Date(window.now.getTime() - actorReservationRetentionSeconds * 1_000)
      await sql`
        DELETE FROM request_admission.actor_windows
        WHERE window_started_at <= ${activeAfter}
      `
      await sql`
        DELETE FROM request_admission.actor_reservations
        WHERE admitted_at <= ${reservationCutoff}
      `

      const rows: ActorCounter[] = []
      for (const dimension of dimensions) {
        let [row] = await sql<ActorCounter[]>`
          SELECT units, window_started_at FROM request_admission.actor_windows
          WHERE domain = ${dimension.domain} AND actor_key = ${dimension.key}
            AND window_started_at > ${activeAfter}
          ORDER BY window_started_at DESC
          LIMIT 1
          FOR UPDATE
        `
        if (!row) {
          await sql`
            INSERT INTO request_admission.actor_windows (domain, actor_key, window_started_at, units)
            VALUES (${dimension.domain}, ${dimension.key}, ${window.now}, 0)
          `
          row = { units: 0, window_started_at: window.now }
        }
        rows.push(row)
      }
      const rejectedIndex = dimensions.findIndex((dimension, index) => rows[index].units + 1 > dimension.limit)
      if (rejectedIndex >= 0) {
        return {
          outcome: 'rate-limited' as const,
          retryAfterSeconds: retryAfterSeconds(window.now, rows[rejectedIndex].window_started_at),
        }
      }
      for (const [index, dimension] of dimensions.entries()) {
        await sql`
          UPDATE request_admission.actor_windows SET units = units + 1
          WHERE domain = ${dimension.domain} AND actor_key = ${dimension.key}
            AND window_started_at = ${rows[index].window_started_at}
        `
      }
      return { outcome: 'admitted' as const }
    })
  }

  return {
    admitActor(actor: AdmissionActor, reservationKey: string) {
      return admitActor(actor, reservationKey)
    },

    admitActorOnce,

    async hasActorReservation(reservationKey: string): Promise<boolean> {
      const [existing] = await client<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM request_admission.actor_reservations WHERE reservation_key = ${reservationKey}
        ) AS exists
      `
      return existing.exists
    },

    async admitSource(input: {
      domain: SourceDomain
      reservationKey: string
      units: number
      caller?: SourceCaller
    }): Promise<SourceAdmissionResult> {
      const configuredLimit = sourceLimits[input.domain]
      if (!configuredLimit) throw new Error(`Unknown source admission domain: ${input.domain}`)
      const sourceWindow = sourceWindowSeconds[input.domain] ?? windowSeconds
      const limit =
        input.caller === 'on-demand' ? configuredLimit : Math.max(0, configuredLimit - sourceBackgroundHeadroom)
      const units = positiveInteger('source units', input.units)
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`source-domain:${input.domain}`}, 0))`
        let window = await captureWindow(sql, sourceWindow)
        const [state] = await sql<SourceState[]>`
          SELECT last_admitted_at, paused_until FROM request_admission.source_backoffs
          WHERE domain = ${input.domain}
        `
        if (state && state.paused_until > window.now) {
          return {
            outcome: 'rate-limited' as const,
            retryAfterSeconds: Math.max(1, Math.ceil((state.paused_until.getTime() - window.now.getTime()) / 1_000)),
          }
        }
        if (state?.last_admitted_at) {
          const spacingWaitMs = state.last_admitted_at.getTime() + minimumSourceSpacingMs - window.now.getTime()
          if (spacingWaitMs > 0) {
            await Bun.sleep(spacingWaitMs)
            window = await captureWindow(sql, sourceWindow)
          }
        }

        const rollingStartedAt = new Date(window.now.getTime() - sourceWindow * 1_000)
        await sql`
          DELETE FROM request_admission.source_reservations
          WHERE domain = ${input.domain} AND admitted_at <= ${rollingStartedAt}
        `
        await sql`
          DELETE FROM request_admission.source_windows
          WHERE domain = ${input.domain} AND window_started_at < ${window.windowStartedAt}
        `
        const [existing] = await sql<{ units: number }[]>`
          SELECT units FROM request_admission.source_reservations
          WHERE domain = ${input.domain} AND reservation_key = ${input.reservationKey}
        `
        if (existing) return { outcome: 'admitted' as const, deduplicated: true }

        const reservations = await sql<SourceReservation[]>`
          SELECT admitted_at, units FROM request_admission.source_reservations
          WHERE domain = ${input.domain} AND admitted_at > ${rollingStartedAt}
          ORDER BY admitted_at, reservation_key
        `
        const used = reservations.reduce((total, reservation) => total + reservation.units, 0)
        if (used + units > limit) {
          const unitsToExpire = used + units - limit
          let expiringUnits = 0
          let retryAt = window.now.getTime() + sourceWindow * 1_000
          for (const reservation of reservations) {
            expiringUnits += reservation.units
            retryAt = reservation.admitted_at.getTime() + sourceWindow * 1_000
            if (expiringUnits >= unitsToExpire) break
          }
          return {
            outcome: 'rate-limited' as const,
            retryAfterSeconds: Math.max(1, Math.ceil((retryAt - window.now.getTime()) / 1_000)),
          }
        }

        await sql`
          INSERT INTO request_admission.source_windows (domain, window_started_at, units)
          VALUES (${input.domain}, ${window.windowStartedAt}, ${units})
          ON CONFLICT (domain, window_started_at)
          DO UPDATE SET units = request_admission.source_windows.units + EXCLUDED.units
        `
        await sql`
          INSERT INTO request_admission.source_reservations (domain, reservation_key, units)
          VALUES (${input.domain}, ${input.reservationKey}, ${units})
        `
        await sql`
          INSERT INTO request_admission.source_backoffs (domain, paused_until, last_admitted_at)
          VALUES (${input.domain}, '-infinity', clock_timestamp())
          ON CONFLICT (domain) DO UPDATE SET last_admitted_at = EXCLUDED.last_admitted_at
        `
        return { outcome: 'admitted' as const, deduplicated: false }
      })
    },

    async pauseSource(domain: SourceDomain, retryAfterSeconds: number): Promise<void> {
      if (!sourceLimits[domain]) throw new Error(`Unknown source admission domain: ${domain}`)
      const duration = positiveInteger('source retryAfterSeconds', retryAfterSeconds)
      await client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`source-domain:${domain}`}, 0))`
        await sql`
          INSERT INTO request_admission.source_backoffs (domain, paused_until, last_admitted_at)
          VALUES (${domain}, clock_timestamp() + ${duration} * interval '1 second', NULL)
          ON CONFLICT (domain) DO UPDATE
          SET paused_until = greatest(request_admission.source_backoffs.paused_until, EXCLUDED.paused_until)
        `
      })
    },

    async inspectCurrentUsage(): Promise<SourceQuotaUsage> {
      const window = await captureWindow(client)
      const domains = (Object.keys(sourceLimits) as SourceDomain[]).sort()
      const maximumWindow = Math.max(...domains.map((domain) => sourceWindowSeconds[domain] ?? windowSeconds))
      const rollingStartedAt = new Date(window.now.getTime() - maximumWindow * 1_000)
      const rows = await client<{ domain: SourceDomain; admitted_at: Date; units: number }[]>`
        SELECT domain, admitted_at, units
        FROM request_admission.source_reservations
        WHERE admitted_at > ${rollingStartedAt}
      `
      return {
        observedAt: window.now.toISOString(),
        windowStartedAt: rollingStartedAt.toISOString(),
        domains: domains.map((domain) => ({
          domain,
          used: rows
            .filter(
              (row) =>
                row.domain === domain &&
                row.admitted_at.getTime() >
                  window.now.getTime() - (sourceWindowSeconds[domain] ?? windowSeconds) * 1_000,
            )
            .reduce((total, row) => total + row.units, 0),
          limit: sourceLimits[domain],
        })),
      }
    },

    async inspectUsage() {
      const [actors] = await client<{ units: number }[]>`
        SELECT coalesce(sum(units), 0)::integer AS units FROM request_admission.actor_windows
      `
      const sources = await client<{ domain: SourceDomain; units: number }[]>`
        SELECT domain, coalesce(sum(units), 0)::integer AS units
        FROM request_admission.source_windows GROUP BY domain
      `
      const [reservations] = await client<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM request_admission.source_reservations
      `
      return {
        actorUnits: actors.units,
        sourceUnits: Object.fromEntries(sources.map(({ domain, units }) => [domain, units])),
        sourceReservations: reservations.count,
      }
    },

    async close() {
      await client.end()
    },
  }
}

export type PostgresRequestAdmission = ReturnType<typeof createPostgresRequestAdmission>
