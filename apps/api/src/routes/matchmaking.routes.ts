import type { Accounts } from '@brawltome/accounts'
import { knownHeroIds, knownLevelIds } from '@brawltome/game-data'
import { type IngestDeps, IngestError, type MatchRepo, ingestReplay } from '@brawltome/matchmaking'
import { ParseBoundsError, type ParsedReplay, parse as parseReplay } from '@brawltome/replay-format'
import type { ActorAdmission } from '@brawltome/request-admission'
import type { R2Client } from '@brawltome/shared'
import type { Telemetry } from '@brawltome/telemetry'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { SESSION_COOKIE, parseCookies } from '../auth/cookies'
import { type R2SourceCallObserver, createObservedR2Put } from '../matchmaking-telemetry'

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
  requestAdmission: ActorAdmission
  telemetry: Telemetry
  accounts: Accounts
  enabled: boolean
  observeSourceCall?: R2SourceCallObserver
}

export function createMatchmakingRoutes(deps: MatchmakingRoutesDeps): Hono {
  const app = new Hono()

  if (!deps.enabled || !deps.matchRepo || !deps.r2) {
    app.all('*', (c) => c.json({ code: 'not_enabled' }, 404))
    return app
  }

  const matchRepo = deps.matchRepo
  const r2 = deps.r2
  const observedR2Put = createObservedR2Put(r2, deps.observeSourceCall)
  const recordIngest = (
    outcome:
      | 'succeeded'
      | 'rate_limited'
      | 'oversize'
      | 'validation_error'
      | 'parse_error'
      | 'rejected'
      | 'dependency_failure',
  ) => deps.telemetry.metrics.add('matchmaking_ingest_total', 1, { outcome })

  app.post(
    '/ingest',
    bodyLimit({
      maxSize: MAX_INGEST_BODY_BYTES,
      onError: (c) => {
        recordIngest('oversize')
        return c.json({ code: 'oversize', detail: 'body_too_large' }, 413)
      },
    }),
    async (c) => {
      const cookies = parseCookies(c.req.header('cookie') ?? '')
      const token = cookies[SESSION_COOKIE]
      const authentication = await deps.accounts.authenticate(token ?? null)
      if (authentication.status === 'anonymous') return c.json({ code: 'unauthorized' }, 401)

      const userId = authentication.account.id

      const admission = await deps.requestAdmission.admitActorOnce({ kind: 'matchmaking-ingest', accountId: userId })
      if (admission.outcome === 'rate-limited') {
        recordIngest('rate_limited')
        return c.json({ code: 'rate_limited' }, 429, { 'Retry-After': String(admission.retryAfterSeconds) })
      }

      let form: FormData
      try {
        form = await c.req.formData()
      } catch {
        recordIngest('validation_error')
        return c.json({ code: 'validation_error', detail: 'bad_multipart' }, 400)
      }
      const rawFile = form.get('raw')
      const payloadField = form.get('payload')
      if (!(rawFile instanceof File) || typeof payloadField !== 'string') {
        recordIngest('validation_error')
        return c.json({ code: 'validation_error', detail: 'multipart_shape' }, 400)
      }
      if (rawFile.size > MAX_INGEST_BODY_BYTES) {
        recordIngest('oversize')
        return c.json({ code: 'oversize', detail: `raw is ${rawFile.size} bytes` }, 413)
      }
      const rawBytes = new Uint8Array(await rawFile.arrayBuffer())
      let parsed: z.infer<typeof payloadSchema>
      try {
        parsed = payloadSchema.parse(JSON.parse(payloadField))
      } catch (err) {
        recordIngest('validation_error')
        return c.json({ code: 'validation_error', detail: err instanceof Error ? err.message : 'bad_payload' }, 400)
      }

      if (parsed.parsedReplay === null) {
        recordIngest('parse_error')
        return c.json({ code: 'parse_error', detail: 'pending_path_not_yet_wired' }, 501)
      }

      // Re-parse the raw bytes ourselves to get a known-good ParsedReplay.
      // ingestReplay re-parses again and asserts equality, catching client tampering.
      let serverParsed: ParsedReplay
      try {
        serverParsed = parseReplay(rawBytes)
      } catch (err) {
        recordIngest('parse_error')
        if (err instanceof ParseBoundsError) deps.telemetry.logger.warn('matchmaking.ingest.parse_bounds')
        return c.json({ code: 'parse_error', detail: err instanceof Error ? err.message : 'bad_raw' }, 400)
      }

      const depsIngest: IngestDeps = {
        matchRepo,
        r2Put: observedR2Put,
        reparseRaw: () => serverParsed,
        knownHeroIds,
        knownLevelIds,
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
        recordIngest('succeeded')
        return c.json({ slug: result.slug, alreadyIngested: result.alreadyIngested ?? false }, 200)
      } catch (e) {
        if (e instanceof IngestError) {
          recordIngest(e.code === 'r2_upload_failed' ? 'dependency_failure' : 'rejected')
          const status = e.code === 'r2_upload_failed' ? 503 : 400
          return c.json({ code: e.code, detail: e.detail }, status)
        }
        throw e
      }
    },
  )

  return app
}
