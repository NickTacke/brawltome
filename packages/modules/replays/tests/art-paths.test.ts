import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { parseArtPath, verifyArtFile } from '../art-paths'
import { MAX_ART_FILE_BYTES } from '../limits'

const groupName = 'a'.repeat(32)

function nameOf(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex').slice(0, 16)
}

// a set index is named by the first 32 hex characters of its sha256
function indexPathOf(bytes: Uint8Array): string {
  return `sets/${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.json`
}

const indexBytes = new TextEncoder().encode('{"format":4,"drawing":1,"patch":"11.01","skins":{}}')

// the 12 bytes every webp starts with: RIFF, the size, WEBP
function webp(body = 'VP8L'): Uint8Array {
  return new TextEncoder().encode(`RIFF\0\0\0\0WEBP${body}`)
}

describe('parseArtPath', () => {
  test('takes the five kinds of art file', () => {
    expect(parseArtPath(`art/${groupName}.json`)).toEqual({ kind: 'art', contentType: 'application/json' })
    expect(parseArtPath(`maps/${groupName}.json`)).toEqual({ kind: 'map', contentType: 'application/json' })
    expect(parseArtPath('sheets/0123456789abcdef.webp')).toEqual({ kind: 'sheet', contentType: 'image/webp' })

    expect(parseArtPath('anims/0123456789abcdef.bin')).toEqual({
      kind: 'anim',
      contentType: 'application/octet-stream',
    })

    expect(parseArtPath(`sets/${groupName}.json`)).toEqual({ kind: 'set-index', contentType: 'application/json' })
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
    `sets/${'a'.repeat(16)}.json`,
    `sets/${'a'.repeat(64)}.json`,
    `sets/${groupName}.webp`,
    `sets/${'A'.repeat(32)}.json`,
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

  test('passes a set index named by its sha256', () => {
    expect(verifyArtFile(indexPathOf(indexBytes), indexBytes)).toBeNull()
  })

  test('gives a reason for a set index whose bytes hash to another name', () => {
    const named = indexPathOf(indexBytes)

    expect(verifyArtFile(`sets/${groupName}.json`, indexBytes)).toStartWith(
      `sets/${groupName}.json holds bytes whose sha256`,
    )

    expect(verifyArtFile(named, new TextEncoder().encode('{"format":4}'))).toBeString()
  })

  test('gives a reason for a set index that is not a json object', () => {
    const list = new TextEncoder().encode('[1]')
    const text = new TextEncoder().encode('{"format":')

    expect(verifyArtFile(indexPathOf(list), list)).toBe(`${indexPathOf(list)} is not a json object`)
    expect(verifyArtFile(indexPathOf(text), text)).toBe(`${indexPathOf(text)} is not valid json`)
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
