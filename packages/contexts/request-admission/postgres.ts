import { createHash, randomUUID } from 'node:crypto'
import type {
  ActorAdmissionResult,
  RefreshActor,
  SourceAdmissionResult,
  SourceDomain,
} from '@brawltome/request-admission'
import postgres from 'postgres'

const defaultWindowSeconds = 15 * 60

type RequestAdmissionConfig = {
  authenticatedIpLimit: number
  sourceLimits: Record<string, number>
  windowSeconds?: number
  afterWindowCaptured?: (capturedAt: Date) => Promise<void>
}

type Counter = { units: number }
type DatabaseTime = { now: Date }

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function actorDimensions(actor: RefreshActor, authenticatedIpLimit: number) {
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
  }
}

export function createPostgresRequestAdmission(connectionString: string, config: RequestAdmissionConfig) {
  const authenticatedIpLimit = positiveInteger('authenticatedIpLimit', config.authenticatedIpLimit)
  const windowSeconds = positiveInteger('windowSeconds', config.windowSeconds ?? defaultWindowSeconds)
  const sourceLimits = Object.fromEntries(
    Object.entries(config.sourceLimits).map(([domain, limit]) => [domain, positiveInteger(`${domain} limit`, limit)]),
  ) as Record<string, number>
  const client = postgres(connectionString)

  async function captureWindow(sql: typeof client) {
    const [databaseTime] = await sql<DatabaseTime[]>`SELECT clock_timestamp() AS now`
    await config.afterWindowCaptured?.(databaseTime.now)
    const windowStartedAt = new Date(
      Math.floor(databaseTime.now.getTime() / (windowSeconds * 1_000)) * windowSeconds * 1_000,
    )
    return { now: databaseTime.now, windowStartedAt }
  }

  function retryAfterSeconds(now: Date, windowStartedAt: Date): number {
    return Math.max(1, Math.ceil((windowStartedAt.getTime() + windowSeconds * 1_000 - now.getTime()) / 1_000))
  }

  return {
    async admitActor(actor: RefreshActor, reservationKey: string = randomUUID()): Promise<ActorAdmissionResult> {
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
        for (const dimension of dimensions) {
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
    },

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
    }): Promise<SourceAdmissionResult> {
      const limit = sourceLimits[input.domain]
      if (!limit) throw new Error(`Unknown source admission domain: ${input.domain}`)
      const units = positiveInteger('source units', input.units)
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.domain}:${input.reservationKey}`}, 0))`
        const [existing] = await sql<{ units: number }[]>`
          SELECT units FROM request_admission.source_reservations
          WHERE domain = ${input.domain} AND reservation_key = ${input.reservationKey}
        `
        if (existing) return { outcome: 'admitted' as const, deduplicated: true }

        const window = await captureWindow(sql)
        await sql`
          INSERT INTO request_admission.source_windows (domain, window_started_at, units)
          VALUES (${input.domain}, ${window.windowStartedAt}, 0)
          ON CONFLICT DO NOTHING
        `
        const [counter] = await sql<Counter[]>`
          SELECT units FROM request_admission.source_windows
          WHERE domain = ${input.domain} AND window_started_at = ${window.windowStartedAt}
          FOR UPDATE
        `
        if (counter.units + units > limit) {
          return {
            outcome: 'rate-limited' as const,
            retryAfterSeconds: retryAfterSeconds(window.now, window.windowStartedAt),
          }
        }
        await sql`
          UPDATE request_admission.source_windows SET units = units + ${units}
          WHERE domain = ${input.domain} AND window_started_at = ${window.windowStartedAt}
        `
        await sql`
          INSERT INTO request_admission.source_reservations (domain, reservation_key, units)
          VALUES (${input.domain}, ${input.reservationKey}, ${units})
        `
        return { outcome: 'admitted' as const, deduplicated: false }
      })
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
