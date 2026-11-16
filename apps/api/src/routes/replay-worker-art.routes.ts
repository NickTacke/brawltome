import {
  type ArtFailureCode,
  type CompleteOutcome,
  MAX_ART_FILE_BYTES,
  MAX_ART_PATHS_PER_CALL,
  parseArtPath,
  type ReplayArtJobs,
} from '@brawltome/replays'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { type Lease, leaseOf, readBounded, workerReportSchema } from './replay-worker-requests'

// after a match is stored the replay worker exports its art: it claims an art job, asks which files the art bucket
// lacks, sends those one by one, then the manifest. mounted under the parse routes, so their token check covers these

// 2000 quoted paths of at most 64 characters
const MAX_MISSING_BODY_BYTES = 256 * 1024
// the manifest, plus the list of map files a warm job made
const MAX_RESULT_BODY_BYTES = MAX_ART_FILE_BYTES + 1024 * 1024

const missingSchema = z.object({ paths: z.array(z.string().max(64)).max(MAX_ART_PATHS_PER_CALL) })

const resultSchema = z.object({
  manifest: z.record(z.string(), z.unknown()).nullable(),
  maps: z.array(z.object({ patch: z.string().max(16), mapId: z.number().int(), path: z.string().max(64) })).max(1000),
  artFormat: z.number().int().min(1).max(32767),
})

const failureCodes = ['no-animations', 'export-failed', 'worker-error'] as const satisfies readonly ArtFailureCode[]

const failureSchema = z.object({ code: z.enum(failureCodes), message: z.string().max(2000) })

export function createReplayWorkerArtRoutes(art: ReplayArtJobs): Hono {
  const app = new Hono()

  app.post('/claim', async (c) => {
    const report = workerReportSchema.safeParse(await c.req.json().catch(() => null))

    if (!report.success) return c.body(null, 400)

    const job = await art.claim(report.data)

    if (!job) return c.body(null, 204)

    const headers: Record<string, string> = {
      'content-type': 'application/gzip',
      'x-art-job': job.jobId,
      'x-art-lease': job.leaseToken,
      'x-art-kind': job.kind,
      'x-art-patch': job.patch,
    }

    if (job.matchId) headers['x-art-match'] = job.matchId

    return new Response(job.line ? new Uint8Array(job.line) : null, { headers })
  })

  app.post('/:id/missing', async (c) => {
    const lease = leaseFrom(c)
    const read = await readJson(c.req.raw, MAX_MISSING_BODY_BYTES)

    if (!read) return c.body(null, 413)

    const body = missingSchema.safeParse(read.json)

    if (!lease || !body.success) return c.body(null, 400)

    const missing = await art.missing(lease.jobId, lease.leaseToken, body.data.paths)

    if (missing === 'lease-lost') return c.body(null, 409)

    return c.json({ missing })
  })

  app.put('/:id/files/:path{.+}', async (c) => {
    const lease = leaseFrom(c)
    const path = c.req.param('path')

    if (!lease) return c.body(null, 400)

    // refused before the body is read, so a stray upload costs nothing
    if (!parseArtPath(path)) return c.text(`${path} is not an art file path`, 422)

    const bytes = await readBounded(c.req.raw, MAX_ART_FILE_BYTES)

    if (!bytes) return c.body(null, 413)

    const outcome = await art.store(lease.jobId, lease.leaseToken, path, bytes)

    if (outcome.status === 'rejected') return c.text(outcome.reason, 422)

    return c.body(null, outcome.status === 'stored' ? 204 : 409)
  })

  app.get('/:id/files/:path{.+}', async (c) => {
    const lease = leaseFrom(c)

    if (!lease) return c.body(null, 400)

    const outcome = await art.read(lease.jobId, lease.leaseToken, c.req.param('path'))

    if (outcome.status === 'found') {
      return new Response(new Uint8Array(outcome.bytes), { headers: { 'content-type': 'application/json' } })
    }

    if (outcome.status === 'refused') return c.text(outcome.reason, 422)

    return c.body(null, outcome.status === 'not-found' ? 404 : 409)
  })

  app.post('/:id/result', async (c) => {
    const lease = leaseFrom(c)
    const read = await readJson(c.req.raw, MAX_RESULT_BODY_BYTES)

    if (!read) return c.body(null, 413)

    const result = resultSchema.safeParse(read.json)

    if (!lease || !result.success) return c.body(null, 400)

    const outcome = await art.complete(lease.jobId, lease.leaseToken, result.data)

    return c.body(null, statusOf(outcome))
  })

  app.post('/:id/failure', async (c) => {
    const lease = leaseFrom(c)
    const failure = failureSchema.safeParse(await c.req.json().catch(() => null))

    if (!lease || !failure.success) return c.body(null, 400)

    const recorded = await art.fail(lease.jobId, lease.leaseToken, failure.data)

    return c.body(null, recorded ? 204 : 409)
  })

  app.post('/:id/renew', async (c) => {
    const lease = leaseFrom(c)

    if (!lease) return c.body(null, 400)

    return c.body(null, (await art.renew(lease.jobId, lease.leaseToken)) ? 204 : 409)
  })

  return app
}

function leaseFrom(c: Context): Lease | null {
  return leaseOf(c.req.param('id') ?? '', c.req.header('x-art-lease'))
}

// null once the body passes limit bytes; json is undefined for a body that isn't json, which every schema refuses
async function readJson(request: Request, limit: number): Promise<{ json: unknown } | null> {
  const bytes = await readBounded(request, limit)

  if (!bytes) return null

  try {
    return { json: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { json: undefined }
  }
}

// a result the art jobs refused failed the job; the worker hears so, though there is nothing left for it to do
function statusOf(outcome: CompleteOutcome): 204 | 404 | 409 | 422 {
  if (outcome === 'failed') return 422

  if (outcome === 'lease-lost') return 409

  if (outcome === 'not-found') return 404

  return 204
}
