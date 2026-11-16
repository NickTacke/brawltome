import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { parseArtPath, verifyArtFile } from '../art-paths'
import { MAX_ART_FILE_BYTES } from '../limits'

const groupName = 'a'.repeat(32)

function nameOf(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex').slice(0, 16)
}

// the 12 bytes every webp starts with: RIFF, the size, WEBP
function webp(body = 'VP8L'): Uint8Array {
  return new TextEncoder().encode(`RIFF\0\0\0\0WEBP${body}`)
}

describe('parseArtPath', () => {
  test('takes the four kinds of art file', () => {
    expect(parseArtPath(`art/${groupName}.json`)).toEqual({ kind: 'art', contentType: 'application/json' })
    expect(parseArtPath(`maps/${groupName}.json`)).toEqual({ kind: 'map', contentType: 'application/json' })
    expect(parseArtPath('sheets/0123456789abcdef.webp')).toEqual({ kind: 'sheet', contentType: 'image/webp' })

    expect(parseArtPath('anims/0123456789abcdef.bin')).toEqual({
      kind: 'anim',
      contentType: 'application/octet-stream',
    })
  })

  test.each([
    '../x',
    'sheets/abc.webp',
    `art/${groupName}.webp`,
    `maps/${'a'.repeat(31)}.json`,
    `art/${'A'.repeat(32)}.json`,
    `/art/${groupName}.json`,
    `art/../art/${groupName}.json`,
    `matches/${groupName}.json`,
    'sheets/0123456789abcdef.webp/',
  ])('refuses %s', (path) => {
    expect(parseArtPath(path)).toBeNull()
  })
})

describe('verifyArtFile', () => {
  test('passes a sheet named by its hash', () => {
    const bytes = webp()

    expect(verifyArtFile(`sheets/${nameOf(bytes)}.webp`, bytes)).toBeNull()
  })

  test('passes a pack named by its hash', () => {
    const bytes = new Uint8Array([1, 2, 3])

    expect(verifyArtFile(`anims/${nameOf(bytes)}.bin`, bytes)).toBeNull()
  })

  test('passes an art group that is a json object', () => {
    expect(verifyArtFile(`art/${groupName}.json`, new TextEncoder().encode('{"format":3}'))).toBeNull()
  })

  test('gives a reason for a sheet whose bytes hash to another name', () => {
    expect(verifyArtFile('sheets/0123456789abcdef.webp', webp())).toBeString()
  })

  test('gives a reason for a pack whose bytes hash to another name', () => {
    expect(verifyArtFile('anims/0123456789abcdef.bin', new Uint8Array([1, 2, 3]))).toBeString()
  })

  test('gives a reason for a sheet that is not a webp', () => {
    const bytes = new TextEncoder().encode('<html></html>')

    expect(verifyArtFile(`sheets/${nameOf(bytes)}.webp`, bytes)).toBeString()
  })

  test('gives a reason for json that does not parse', () => {
    expect(verifyArtFile(`maps/${groupName}.json`, new TextEncoder().encode('{"format":'))).toBeString()
  })

  test('gives a reason for json that is not an object', () => {
    expect(verifyArtFile(`art/${groupName}.json`, new TextEncoder().encode('[1]'))).toBeString()
  })

  test('gives a reason for a file over the size cap', () => {
    const bytes = new Uint8Array(MAX_ART_FILE_BYTES + 1)

    expect(verifyArtFile(`anims/${nameOf(bytes)}.bin`, bytes)).toBeString()
  })

  test('gives a reason for a path outside the art layout', () => {
    expect(verifyArtFile('../x', new Uint8Array([1]))).toBeString()
  })
})
