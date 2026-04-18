import type { GetCurrentUserDeps } from '@brawltome/identity'
import { getCurrentUser } from '@brawltome/identity'
import { type IngestDeps, IngestError, type MatchRepo, ingestReplay } from '@brawltome/matchmaking'
import { type ParsedReplay, parse as parseReplay } from '@brawltome/replay-format'
import { type MetricsRegistry, type R2Client, checkRateLimit } from '@brawltome/shared'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Redis } from 'ioredis'
import { z } from 'zod'
import { SESSION_COOKIE, parseCookies } from '../auth/cookies'

const MAX_INGEST_BODY_BYTES = 256 * 1024

const entityBhidsSchema = z.record(z.string().regex(/^\d+$/), z.number().int().positive())

const payloadSchema = z.object({
  parsedReplay: z.any().nullable(),
  entityBhids: entityBhidsSchema,
  formatVersion: z.number().int().nullable(),
})

export interface MatchmakingRoutesDeps {
  matchRepo: MatchRepo | null
  r2: R2Client | null
  redis: Redis
  metrics: MetricsRegistry
  getUserFromCookie: GetCurrentUserDeps
  enabled: boolean
}

export function createMatchmakingRoutes(deps: MatchmakingRoutesDeps): Hono {
  const app = new Hono()

  if (!deps.enabled || !deps.matchRepo || !deps.r2) {
    app.all('*', (c) => c.json({ code: 'not_enabled' }, 404))
    return app
  }

  const matchRepo = deps.matchRepo
  const r2 = deps.r2

  app.post(
    '/ingest',
    bodyLimit({
      maxSize: MAX_INGEST_BODY_BYTES,
      onError: (c) => {
        void deps.metrics.incrementCounter('matchmaking_ingest_rejected_oversize')
        return c.json({ code: 'oversize', detail: 'body_too_large' }, 413)
      },
    }),
    async (c) => {
      const cookies = parseCookies(c.req.header('cookie') ?? '')
      const token = cookies[SESSION_COOKIE]
      const current = await getCurrentUser(deps.getUserFromCookie, token ?? null)
      if (!current) return c.json({ code: 'unauthorized' }, 401)

      const userId = current.user.id

      const rl = await checkRateLimit(deps.redis, `user:${userId}`, 'ingest')
      if (!rl.allowed) {
        await deps.metrics.incrementCounter('matchmaking_ingest_rejected_rate_limited')
        return c.json({ code: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfter) })
      }

      let form: FormData
      try {
        form = await c.req.formData()
      } catch {
        await deps.metrics.incrementCounter('matchmaking_ingest_rejected_validation_error')
        return c.json({ code: 'validation_error', detail: 'bad_multipart' }, 400)
      }
      const rawFile = form.get('raw')
      const payloadField = form.get('payload')
      if (!(rawFile instanceof File) || typeof payloadField !== 'string') {
        await deps.metrics.incrementCounter('matchmaking_ingest_rejected_validation_error')
        return c.json({ code: 'validation_error', detail: 'multipart_shape' }, 400)
      }
      if (rawFile.size > MAX_INGEST_BODY_BYTES) {
        await deps.metrics.incrementCounter('matchmaking_ingest_rejected_oversize')
        return c.json({ code: 'oversize', detail: `raw is ${rawFile.size} bytes` }, 413)
      }
      const rawBytes = new Uint8Array(await rawFile.arrayBuffer())
      let parsed: z.infer<typeof payloadSchema>
      try {
        parsed = payloadSchema.parse(JSON.parse(payloadField))
      } catch (err) {
        await deps.metrics.incrementCounter('matchmaking_ingest_rejected_validation_error')
        return c.json({ code: 'validation_error', detail: err instanceof Error ? err.message : 'bad_payload' }, 400)
      }

      if (parsed.parsedReplay === null) {
        await deps.metrics.incrementCounter('matchmaking_ingest_rejected_parse_error')
        return c.json({ code: 'parse_error', detail: 'pending_path_not_yet_wired' }, 501)
      }

      // Re-parse the raw bytes ourselves to get a known-good ParsedReplay.
      // ingestReplay re-parses again and asserts equality, catching client tampering.
      let serverParsed: ParsedReplay
      try {
        serverParsed = parseReplay(rawBytes)
      } catch (err) {
        await deps.metrics.incrementCounter('matchmaking_ingest_rejected_parse_error')
        return c.json({ code: 'parse_error', detail: err instanceof Error ? err.message : 'bad_raw' }, 400)
      }

      const depsIngest: IngestDeps = {
        matchRepo,
        r2Put: (key, bytes) => r2.put(key, bytes),
        reparseRaw: () => serverParsed,
      }
      const entityBhids = Object.fromEntries(Object.entries(parsed.entityBhids).map(([k, v]) => [Number(k), v]))

      try {
        const result = await ingestReplay(depsIngest, {
          userId,
          parsedReplay: parsed.parsedReplay as ParsedReplay,
          entityBhids,
          rawBytes,
          formatVersion: parsed.formatVersion ?? serverParsed.formatVersion,
        })
        await deps.metrics.incrementCounter('matchmaking_ingest_ok')
        return c.json({ slug: result.slug, alreadyIngested: result.alreadyIngested ?? false }, 200)
      } catch (e) {
        if (e instanceof IngestError) {
          await deps.metrics.incrementCounter(`matchmaking_ingest_rejected_${e.code}`)
          const status = e.code === 'r2_upload_failed' ? 503 : 400
          return c.json({ code: e.code, detail: e.detail }, status)
        }
        throw e
      }
    },
  )

  return app
}
