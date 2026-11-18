import type { ObjectStore } from '@brawltome/foundation'

// the module keeps lines, insights and playback timelines in the object store as gzipped JSON

export function gzipJson(value: unknown): Uint8Array<ArrayBuffer> {
  return Bun.gzipSync(new TextEncoder().encode(JSON.stringify(value)))
}

export function gunzipJson(bytes: Uint8Array): unknown {
  // Bun's gunzip only takes bytes over a plain ArrayBuffer, which the object store doesn't promise
  return JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(bytes))))
}

/** A match's line as bh-native printed it, parsed; throws when the store doesn't hold it. */
export async function readStoredLine(objectStore: ObjectStore, timelineKey: string): Promise<unknown> {
  const bytes = await objectStore.get(timelineKey)

  if (!bytes) throw new Error(`read the line ${timelineKey}: the object store doesn't hold it`)

  return gunzipJson(bytes)
}
