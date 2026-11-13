import { type JobFailureCode, MAX_LINE_BYTES, MAX_LINE_GZIP_BYTES, type ReplayJobs } from '@brawltome/replays'
import { Hono } from 'hono'
import { z } from 'zod'
import { internalSecretValid } from '../auth/internal-secret'

// the replay worker on VM 106 is the only caller: it claims a job, plays the replay with bh-native and answers.
// nothing here is public; the worker authenticates with its own token

const idSchema = z.uuid()
const reportSchema = z.object({ build: z.string().min(1).max(64), patches: z.array(z.string().max(16)).max(10) })

const failureCodes = [
  'game-error',
  'unreadable',
  'never-ended',
  'patch-not-supported',
  'unknown-format',
  'not-your-match',
  'worker-error',
] as const satisfies readonly JobFailureCode[]

const failureSchema = z.object({ code: z.enum(failureCodes), message: z.string().max(2000) })

export function createReplayWorkerRoutes(deps: { jobs: ReplayJobs; token: string }): Hono {
  const app = new Hono()

  app.use(async (c, next) => {
    const provided = c.req.header('authorization')?.replace(/^Bearer /, '')

    if (!internalSecretValid(provided, deps.token)) return c.body(null, 401)

    await next()
  })

  app.post('/claim', async (c) => {
    const report = reportSchema.safeParse(await c.req.json().catch(() => null))

    if (!report.success) return c.body(null, 400)

    const job = await deps.jobs.claim(report.data)

    if (!job) return c.body(null, 204)

    return new Response(new Uint8Array(job.replayBytes), {
      headers: {
        'content-type': 'application/octet-stream',
        'x-replay-job': job.jobId,
        'x-replay-lease': job.leaseToken,
        'x-replay-kind': job.kind,
        'x-replay-digest': job.digest,
      },
    })
  })

  app.post('/:id/result', async (c) => {
    const lease = leaseOf(c.req.param('id'), c.req.header('x-replay-lease'))

    if (!lease) return c.body(null, 400)

    const gzipped = await readBounded(c.req.raw, MAX_LINE_GZIP_BYTES)

    if (!gzipped) return c.body(null, 413)

    const line = await gunzipBounded(gzipped, MAX_LINE_BYTES)

    if (line === null) return c.body(null, 413)

    const outcome = await deps.jobs.complete({ ...lease, line })

    return c.body(null, statusOf(outcome))
  })

  app.post('/:id/failure', async (c) => {
    const lease = leaseOf(c.req.param('id'), c.req.header('x-replay-lease'))
    const failure = failureSchema.safeParse(await c.req.json().catch(() => null))

    if (!lease || !failure.success) return c.body(null, 400)

    const recorded = await deps.jobs.fail({ ...lease, ...failure.data })

    return c.body(null, recorded ? 204 : 409)
  })

  app.post('/:id/renew', async (c) => {
    const lease = leaseOf(c.req.param('id'), c.req.header('x-replay-lease'))

    if (!lease) return c.body(null, 400)

    return c.body(null, (await deps.jobs.renew(lease.jobId, lease.leaseToken)) ? 204 : 409)
  })

  app.post('/:id/release', async (c) => {
    const lease = leaseOf(c.req.param('id'), c.req.header('x-replay-lease'))

    if (!lease) return c.body(null, 400)

    return c.body(null, (await deps.jobs.release(lease.jobId, lease.leaseToken)) ? 204 : 409)
  })

  return app
}

function leaseOf(jobId: string, leaseToken: string | undefined): { jobId: string; leaseToken: string } | null {
  if (!idSchema.safeParse(jobId).success || !idSchema.safeParse(leaseToken).success) return null

  return { jobId, leaseToken: leaseToken as string }
}

function statusOf(outcome: 'completed' | 'failed' | 'lease-lost' | 'not-found'): 204 | 404 | 409 {
  if (outcome === 'lease-lost') return 409

  if (outcome === 'not-found') return 404

  return 204
}

async function readBounded(request: Request, limit: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null

  const chunks: Uint8Array[] = []
  let size = 0

  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength
    if (size > limit) return null

    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

// streamed with a cap, so a small gzip that inflates to gigabytes is refused instead of filling memory
async function gunzipBounded(gzipped: Uint8Array, limit: number): Promise<string | null> {
  const stream = new Blob([new Uint8Array(gzipped)]).stream().pipeThrough(new DecompressionStream('gzip'))
  const chunks: Uint8Array[] = []
  let size = 0

  for await (const chunk of stream) {
    size += chunk.byteLength
    if (size > limit) return null

    chunks.push(chunk)
  }

  return new TextDecoder().decode(Buffer.concat(chunks))
}
