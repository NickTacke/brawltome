import { createHash } from 'node:crypto'
import type { Accounts } from '@brawltome/accounts'
import {
  REPLAY_UPLOAD_LIMIT_BYTES,
  analysisResultV1Schema,
  replayJobDetailSchema,
  replayJobFailureSchema,
  replayJobSummarySchema,
} from '@brawltome/contracts'
import { ActiveReplayJobError, type ReplayAnalysisJobs } from '@brawltome/replay-analysis'
import { Hono } from 'hono'
import { z } from 'zod'
import { SESSION_COOKIE, parseCookies } from '../auth/cookies'
import { internalSecretValid } from '../auth/internal-secret'

const RESULT_LIMIT_BYTES = 64 * 1024 * 1024
const CLAIM_LEASE_SECONDS = 10 * 60
const idSchema = z.string().uuid()

async function readBounded(request: Request, limit: number): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > limit) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength
    if (size > limit) return null
    chunks.push(chunk)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function cleanFileName(value: string | undefined): string | null {
  if (!value) return null
  try {
    const leaf = decodeURIComponent(value).split(/[\\/]/).at(-1) ?? ''
    const name = Array.from(leaf, (character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127 ? '' : character
    })
      .join('')
      .trim()
    return name ? name.slice(0, 255) : null
  } catch {
    return null
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => {
      if (left === right) return 0
      return left < right ? -1 : 1
    })
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`
}

function coreDigest(core: unknown): string {
  const bytes = canonicalJson({ core, schemaVersion: 1 })
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

async function accountId(request: Request, accounts: Accounts): Promise<string | null> {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE] ?? null
  const authentication = await accounts.authenticate(token)
  return authentication.status === 'signedIn' ? authentication.account.id : null
}

function bridgeAuthorized(request: Request, secret: string): boolean {
  const authorization = request.headers.get('authorization')
  return authorization?.startsWith('Bearer ') === true && internalSecretValid(authorization.slice(7), secret)
}

export function createReplayAnalysisRoutes(deps: {
  accounts: Accounts
  jobs: ReplayAnalysisJobs
  webOrigin: string
}) {
  const app = new Hono()

  app.post('/replays', async (c) => {
    if (c.req.header('origin') !== deps.webOrigin) return c.json({ error: 'csrf' }, 403)
    const ownerId = await accountId(c.req.raw, deps.accounts)
    if (!ownerId) return c.json({ error: 'unauthorized' }, 401)
    if (c.req.header('content-type') !== 'application/octet-stream') {
      return c.json({ error: 'unsupported_media' }, 415)
    }
    const replayBytes = await readBounded(c.req.raw, REPLAY_UPLOAD_LIMIT_BYTES)
    if (!replayBytes) return c.json({ error: 'payload_too_large' }, 413)
    if (replayBytes.byteLength === 0) return c.json({ error: 'empty_replay' }, 400)
    const replayDigest = `sha256:${createHash('sha256').update(replayBytes).digest('hex')}`
    try {
      const job = await deps.jobs.create({
        accountId: ownerId,
        replayBytes,
        replayDigest,
        fileName: cleanFileName(c.req.header('x-replay-file-name')),
      })
      return c.json(replayJobSummarySchema.parse(job), 202)
    } catch (error) {
      if (error instanceof ActiveReplayJobError) return c.json({ error: 'replay_already_active' }, 409)
      throw error
    }
  })

  app.get('/replays', async (c) => {
    const ownerId = await accountId(c.req.raw, deps.accounts)
    if (!ownerId) return c.json({ error: 'unauthorized' }, 401)
    return c.json(replayJobSummarySchema.array().parse(await deps.jobs.list(ownerId)))
  })

  app.get('/replays/:id', async (c) => {
    const ownerId = await accountId(c.req.raw, deps.accounts)
    if (!ownerId) return c.json({ error: 'unauthorized' }, 401)
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)
    const job = await deps.jobs.get(ownerId, id.data)
    return job ? c.json(replayJobDetailSchema.parse(job)) : c.json({ error: 'not_found' }, 404)
  })

  return app
}

export function createReplayBridgeRoutes(deps: { jobs: ReplayAnalysisJobs; secret: string }) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    if (!bridgeAuthorized(c.req.raw, deps.secret)) return c.json({ error: 'unauthorized' }, 401)
    return next()
  })

  app.post('/claim', async () => {
    const job = await deps.jobs.claim(CLAIM_LEASE_SECONDS)
    if (!job) return new Response(null, { status: 204 })
    const replayBody = new Uint8Array(job.replayBytes.byteLength)
    replayBody.set(job.replayBytes)
    return new Response(replayBody.buffer, {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/octet-stream',
        'x-replay-digest': job.replayDigest,
        'x-replay-job-id': job.id,
        'x-replay-lease-seconds': String(CLAIM_LEASE_SECONDS),
        'x-replay-lease-token': job.leaseToken,
      },
    })
  })

  app.post('/:id/result', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)
    const leaseToken = idSchema.safeParse(c.req.header('x-replay-lease-token'))
    if (!leaseToken.success) return c.json({ error: 'invalid_lease' }, 400)
    const body = await readBounded(c.req.raw, RESULT_LIMIT_BYTES)
    if (!body) return c.json({ error: 'payload_too_large' }, 413)
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder().decode(body))
    } catch {
      return c.json({ error: 'invalid_json' }, 400)
    }
    const parsed = analysisResultV1Schema.safeParse(value)
    if (!parsed.success) return c.json({ error: 'invalid_analysis_result' }, 400)
    if (parsed.data.coreDigest !== coreDigest(parsed.data.core)) {
      return c.json({ error: 'invalid_core_digest' }, 400)
    }
    const native = parsed.data.extensions['https://github.com/NickTacke/brawlhalla-replay-processor/extensions/native']
    const summary =
      parsed.data.extensions['https://github.com/NickTacke/brawlhalla-replay-processor/extensions/match-summary']
    if (native.inputCoreDigest !== parsed.data.coreDigest || summary?.inputCoreDigest !== parsed.data.coreDigest) {
      return c.json({ error: 'invalid_extension_digest' }, 400)
    }
    const outcome = await deps.jobs.complete(
      id.data,
      leaseToken.data,
      parsed.data.core.replay.replayDigest,
      parsed.data,
    )
    if (outcome === 'not-found') return c.json({ error: 'not_found' }, 404)
    if (outcome === 'lease-lost') return c.json({ error: 'lease_lost' }, 409)
    if (outcome === 'digest-mismatch') return c.json({ error: 'replay_digest_mismatch' }, 409)
    return c.body(null, 204)
  })

  app.post('/:id/failure', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)
    const leaseToken = idSchema.safeParse(c.req.header('x-replay-lease-token'))
    if (!leaseToken.success) return c.json({ error: 'invalid_lease' }, 400)
    const body = await readBounded(c.req.raw, 4_096)
    if (!body) return c.json({ error: 'payload_too_large' }, 413)
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder().decode(body))
    } catch {
      return c.json({ error: 'invalid_json' }, 400)
    }
    const failure = replayJobFailureSchema.safeParse(value)
    if (!failure.success) return c.json({ error: 'invalid_failure' }, 400)
    return (await deps.jobs.fail(id.data, leaseToken.data, failure.data))
      ? c.body(null, 204)
      : c.json({ error: 'lease_lost' }, 409)
  })

  app.post('/:id/renew', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)
    const leaseToken = idSchema.safeParse(c.req.header('x-replay-lease-token'))
    if (!leaseToken.success) return c.json({ error: 'invalid_lease' }, 400)
    return (await deps.jobs.renew(id.data, leaseToken.data, CLAIM_LEASE_SECONDS))
      ? c.body(null, 204)
      : c.json({ error: 'lease_lost' }, 409)
  })

  app.post('/:id/release', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'))
    if (!id.success) return c.json({ error: 'not_found' }, 404)
    const leaseToken = idSchema.safeParse(c.req.header('x-replay-lease-token'))
    if (!leaseToken.success) return c.json({ error: 'invalid_lease' }, 400)
    return (await deps.jobs.release(id.data, leaseToken.data))
      ? c.body(null, 204)
      : c.json({ error: 'lease_lost' }, 409)
  })

  return app
}
