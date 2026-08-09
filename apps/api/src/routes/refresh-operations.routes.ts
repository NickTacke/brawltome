import type { AcceptProofOperation } from '@brawltome/refresh-operations'
import { Hono } from 'hono'
import { z } from 'zod'
import { internalSecretValid } from '../auth/internal-secret'

const proofInputSchema = z
  .object({
    dedupeKey: z.string().min(1).max(200),
    operationKey: z.string().min(1).max(200),
    value: z.string().max(1_000),
    requestedBy: z.string().min(1).max(200).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
  })
  .strict()

const maxBodyBytes = 4_096

type ProofOperationProducer = {
  accept(input: AcceptProofOperation): Promise<{ outcome: 'accepted' | 'already-active'; operationId: string }>
}

async function readBoundedJson(request: Request): Promise<{ value?: unknown; tooLarge: boolean }> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > maxBodyBytes) return { tooLarge: true }
  if (!request.body) return { tooLarge: false }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBodyBytes) {
      await reader.cancel()
      return { tooLarge: true }
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(body)), tooLarge: false }
  } catch {
    return { tooLarge: false }
  }
}

export function createRefreshOperationRoutes(producer: ProofOperationProducer, expectedSecret: string | undefined) {
  const app = new Hono()
  app.post('/proof', async (c) => {
    if (!internalSecretValid(c.req.header('x-internal-secret'), expectedSecret)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const body = await readBoundedJson(c.req.raw)
    if (body.tooLarge) return c.json({ error: 'payload_too_large' }, 413)
    const parsed = proofInputSchema.safeParse(body.value)
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400)

    const result = await producer.accept({
      dedupeKey: parsed.data.dedupeKey,
      operationKey: parsed.data.operationKey,
      workClass: 'interactive',
      payload: { value: parsed.data.value },
      provenance: { source: 'internal-api', requestedBy: parsed.data.requestedBy },
      maxAttempts: parsed.data.maxAttempts,
    })
    return c.json(result, result.outcome === 'accepted' ? 202 : 200)
  })
  return app
}
