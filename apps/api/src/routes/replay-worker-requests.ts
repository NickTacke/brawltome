import { z } from 'zod'

// what the replay worker's parse and art routes read from a request the same way

const idSchema = z.uuid()

// artFormat is the art export format the worker runs; a worker without the export sends none
export const workerReportSchema = z.object({
  build: z.string().min(1).max(64),
  patches: z.array(z.string().max(16)).max(10),
  artFormat: z.number().int().min(1).max(32767).nullable().default(null),
})

export type Lease = { jobId: string; leaseToken: string }

/** The job and lease a request names, or null when either isn't an id. */
export function leaseOf(jobId: string, leaseToken: string | undefined): Lease | null {
  if (!idSchema.safeParse(jobId).success || !idSchema.safeParse(leaseToken).success) return null

  return { jobId, leaseToken: leaseToken as string }
}

/** The request's body, or null once it passes limit bytes; it stops reading there. */
export async function readBounded(request: Request, limit: number): Promise<Uint8Array | null> {
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
