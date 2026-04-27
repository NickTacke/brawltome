import { SUPPORTED_FORMAT_VERSIONS } from './constants'
import { decodeEnvelope } from './envelope'
import { FormatVersionUnsupportedError } from './errors'
import { parse264 } from './parser264'
import type { ParsedReplay } from './types'

export { peekFormatVersion } from './envelope'
export { ParseBoundsError } from './errors'

export function parse(raw: Uint8Array): ParsedReplay {
  const body = decodeEnvelope(raw)
  if (body.length < 4) throw new FormatVersionUnsupportedError(-1)
  const dv = new DataView(body.buffer, body.byteOffset, 4)
  const v = dv.getUint32(0)
  if (!SUPPORTED_FORMAT_VERSIONS.has(v)) throw new FormatVersionUnsupportedError(v)
  switch (v) {
    case 264:
      return parse264(body)
    default:
      throw new FormatVersionUnsupportedError(v)
  }
}
