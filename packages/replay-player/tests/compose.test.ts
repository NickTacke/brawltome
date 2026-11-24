// the compose arithmetic against brawlhalla-anims' own. Each fixture is a piece of a set `predraw draw --check` drew
// from 11.01: skin 517 (FerrymanMoth, whose busiest piece keeps 22 colours on 8 weight sheets), katar weapon skin 2031
// (its hands coloured by the skin holding it) and the orb's FirstPickUp class set (its pickup flash in a map's crate
// colours). Each has the look --check composes it in, the colours anims resolves that look to, and in a .bin.gz the
// piece's decoded base (RGBA), its weight sheets (RGB) and the piece anims' composePiece made of them (RGBA)
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { composePiece, resolvedColors, type SheetPixels, type Swap } from '../src/compose.ts'

const folder = join(import.meta.dir, 'fixtures', 'compose')

type Fixture = {
  piece: number
  width: number
  height: number
  weightSheets: number
  swappable: number[]
  swaps: Swap[]
  colors: number[]
}

type FixturePixels = { base: SheetPixels; weights: SheetPixels[]; expected: Uint8Array }

const names = readdirSync(folder)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.slice(0, -'.json'.length))

function fixtureOf(name: string): Fixture {
  return JSON.parse(readFileSync(join(folder, `${name}.json`), 'utf8')) as Fixture
}

function pixelsOf(name: string, fixture: Fixture): FixturePixels {
  const bytes = new Uint8Array(gunzipSync(readFileSync(join(folder, `${name}.bin.gz`))))
  const area = fixture.width * fixture.height
  const base = { width: fixture.width, channels: 4, pixels: bytes.subarray(0, area * 4) }

  const weights = Array.from({ length: fixture.weightSheets }, (_, sheet) => {
    const from = area * 4 + sheet * area * 3

    return { width: fixture.width, channels: 3, pixels: bytes.subarray(from, from + area * 3) }
  })

  const expectedFrom = area * 4 + fixture.weightSheets * area * 3

  return { base, weights, expected: bytes.subarray(expectedFrom, expectedFrom + area * 4) }
}

// differingBytes counts the bytes where two pieces differ
function differingBytes(composed: Uint8ClampedArray, expected: Uint8Array): number {
  let count = 0

  for (let at = 0; at < expected.length; at++) if (composed[at] !== expected[at]) count++

  return count
}

describe.each(names)('%s', (name) => {
  const fixture = fixtureOf(name)

  test('resolves its colours as anims does', () => {
    expect(resolvedColors(fixture.swappable, fixture.swaps)).toEqual(fixture.colors)
  })

  test('composes to exactly the bytes anims composes', () => {
    const { base, weights, expected } = pixelsOf(name, fixture)
    const composed = new Uint8ClampedArray(expected.length)
    const rect = { sx: 0, sy: 0, sw: fixture.width, sh: fixture.height }

    composePiece(base, weights, rect, fixture.colors, composed)

    expect(differingBytes(composed, expected)).toBe(0)
  })
})

describe('composing a faint pixel', () => {
  test("starts from the base's premultiplied colour as a canvas holds it, in a byte", () => {
    // 200 at alpha 3 is 2.35 premultiplied, which a canvas holds as 2 and hands back as 170
    const base = { width: 1, channels: 4, pixels: new Uint8ClampedArray([200, 0, 0, 3]) }
    const weights = [{ width: 1, channels: 3, pixels: new Uint8ClampedArray([0, 0, 0]) }]
    const composed = new Uint8ClampedArray(4)

    composePiece(base, weights, { sx: 0, sy: 0, sw: 1, sh: 1 }, [0x0000ff], composed)

    expect([...composed]).toEqual([170, 0, 0, 3])
  })
})

describe('resolving a colour', () => {
  const entry = [1, 0x111111, 0x222222, 0x333333]

  test('takes its first swap of the piece type over one of no type', () => {
    const swaps: Swap[] = [
      [0x111111, 0xaaaaaa, 0],
      [0x111111, 0xbbbbbb, 1],
      [0x111111, 0xcccccc, 1],
    ]

    expect(resolvedColors(entry, swaps)).toEqual([0xbbbbbb, 0x222222, 0x333333])
  })

  test('falls back on a swap of no type, and keeps a colour no swap reaches', () => {
    const swaps: Swap[] = [
      [0x222222, 0xaaaaaa, 0],
      [0x222222, 0xbbbbbb, 2],
    ]

    expect(resolvedColors(entry, swaps)).toEqual([0x111111, 0xaaaaaa, 0x333333])
  })

  test('counts a swap to 0 as none', () => {
    const swaps: Swap[] = [
      [0x111111, 0xaaaaaa, 0],
      [0x111111, 0, 1],
      [0x333333, 0, 0],
    ]

    expect(resolvedColors(entry, swaps)).toEqual([0xaaaaaa, 0x222222, 0x333333])
  })

  test('gives a piece with no colour rule no colours', () => {
    expect(resolvedColors([], [[0x111111, 0xaaaaaa, 0]])).toEqual([])
  })
})
