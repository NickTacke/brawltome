/** Files kept outside Postgres, addressed by key. */
export type ObjectStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>
  /** null when the key doesn't exist */
  get(key: string): Promise<Uint8Array | null>
  /** deleting a key that doesn't exist is not an error */
  delete(key: string): Promise<void>
}

export type S3ObjectStoreOptions = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/** An S3-compatible bucket, such as Cloudflare R2, through Bun's own client. */
export function createS3ObjectStore(options: S3ObjectStoreOptions): ObjectStore {
  const client = new Bun.S3Client(options)

  return {
    async put(key, body, contentType) {
      await client.write(key, body, { type: contentType })
    },

    async get(key) {
      const file = client.file(key)

      if (!(await file.exists())) return null

      return new Uint8Array(await file.arrayBuffer())
    },

    async delete(key) {
      await client.delete(key)
    },
  }
}
