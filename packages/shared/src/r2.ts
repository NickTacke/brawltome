import { S3Client } from 'bun'

export interface R2Config {
  accessKeyId: string
  secretAccessKey: string
  endpoint: string
  bucket: string
}

export interface R2Client {
  put(key: string, bytes: Uint8Array, opts?: { contentType?: string }): Promise<void>
  get(key: string): Promise<Uint8Array>
  delete(key: string): Promise<void>
  presignGet(key: string, ttlSec?: number): string
}

export function createR2Client(cfg: R2Config): R2Client | null {
  if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.endpoint || !cfg.bucket) return null
  const client = new S3Client({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    endpoint: cfg.endpoint,
    bucket: cfg.bucket,
  })
  return {
    async put(key, bytes, opts) {
      await client.write(key, bytes, {
        type: opts?.contentType ?? 'application/octet-stream',
      })
    },
    async get(key) {
      return new Uint8Array(await client.file(key).arrayBuffer())
    },
    async delete(key) {
      await client.delete(key)
    },
    presignGet(key, ttlSec = 300) {
      return client.presign(key, { expiresIn: ttlSec, method: 'GET' })
    },
  }
}
