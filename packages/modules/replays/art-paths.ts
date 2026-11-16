import { createHash } from 'node:crypto'
import { MAX_ART_FILE_BYTES } from './limits'

// the files the replay worker may put in the public art bucket, as the brawlhalla-anims export names them. art groups
// and map files are named by a fingerprint of their inputs, so only their shape can be checked; sheets and packs are
// named by their content, so their bytes must hash to their name

export type ArtFileKind = 'art' | 'sheet' | 'anim' | 'map'

const artPathRules: { pattern: RegExp; kind: ArtFileKind; contentType: string }[] = [
  { pattern: /^art\/[0-9a-f]{32}\.json$/, kind: 'art', contentType: 'application/json' },
  { pattern: /^maps\/[0-9a-f]{32}\.json$/, kind: 'map', contentType: 'application/json' },
  { pattern: /^sheets\/[0-9a-f]{16}\.webp$/, kind: 'sheet', contentType: 'image/webp' },
  { pattern: /^anims\/[0-9a-f]{16}\.bin$/, kind: 'anim', contentType: 'application/octet-stream' },
]

/** The kind of art file a path names, or null for anything outside the art layout. */
export function parseArtPath(path: string): { kind: ArtFileKind; contentType: string } | null {
  const rule = artPathRules.find(({ pattern }) => pattern.test(path))

  if (!rule) return null

  return { kind: rule.kind, contentType: rule.contentType }
}

/** Why a file may not be stored under its path, or null when it may. */
export function verifyArtFile(path: string, bytes: Uint8Array): string | null {
  const parsed = parseArtPath(path)

  if (!parsed) return `${path} is not an art file path`

  if (bytes.byteLength > MAX_ART_FILE_BYTES) return `${path} is ${bytes.byteLength} bytes, over ${MAX_ART_FILE_BYTES}`

  if (parsed.kind === 'art' || parsed.kind === 'map') return jsonObjectProblem(path, bytes)

  if (parsed.kind === 'sheet' && !isWebp(bytes)) return `${path} is not a webp image`

  return contentNameProblem(path, bytes)
}

function jsonObjectProblem(path: string, bytes: Uint8Array): string | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return `${path} is not valid json`
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return `${path} is not a json object`

  return null
}

// RIFF, four bytes of size, WEBP
function isWebp(bytes: Uint8Array): boolean {
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 12))

  return header.startsWith('RIFF') && header.endsWith('WEBP')
}

// the export names a sheet or pack by the first 16 hex characters of its sha1
function contentNameProblem(path: string, bytes: Uint8Array): string | null {
  const name = path.slice(path.indexOf('/') + 1, path.lastIndexOf('.'))
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 16)

  if (hash !== name) return `${path} holds bytes whose sha1 starts ${hash}`

  return null
}
