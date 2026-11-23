// in a format 4 group a sprite frame past the end of a bone's row shows the row's last piece; in format 3 it shows none
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AnyArtGroup, ArtGroup, ArtGroupFormat4 } from '../src/format.ts'
import { readPack } from '../src/pack.ts'
import { Animations, ArtSet, eachDraw, groupOf, type Matrix } from '../src/placement.ts'
import { writePack } from './pack-writer.ts'

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

// a piece is named by its group times this plus its index there
const PIECES = 0x10000

const readSet = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', 'format-4', `${name}.json`), 'utf8')) as ArtGroupFormat4

// the PistolCowgirl weapon skin's set: each of its two bones draws one frame
const pistol = readSet('583f0e4a79e7ae898cb46b0d1a0d1013')
// the orb's FirstPickUp class set: its pickup flash bone draws eight frames
const pickup = readSet('2b6dca814eb474124bef818ad8395d4c')

function groupOfFormat(format: 3 | 4, bones: Record<string, number[]>, weapons = {}): AnyArtGroup {
  const group = { sheets: [], pieces: [], bones, weapons }

  return format === 3 ? ({ ...group, format } as ArtGroup) : ({ ...group, format } as ArtGroupFormat4)
}

type Shown = { weapon?: string; isLoaded?: (ref: number) => boolean }

// piecesShown is the pieces a player drawing from the groups shows for one bone at a sprite frame
function piecesShown(groups: AnyArtGroup[], bone: string, spriteFrame: number, shown: Shown = {}): number[] {
  const set = new ArtSet(
    groups.map((_, index) => index),
    (index) => groups[index],
  )

  const draw = { name: bone, spriteFrame, opacity: 1, matrix: IDENTITY }
  const pack = readPack(writePack([{ index: 0, frameCount: 1, frames: new Map([[0, [draw]]]) }]).buffer)
  const animations = new Animations()

  animations.add(pack, set)

  const frame = animations.frame(0, 0)
  const refs: number[] = []

  if (!frame) throw new Error('expected the frame in the pack')

  eachDraw(set, shown.weapon ?? '', frame, IDENTITY, shown.isLoaded ?? (() => true), (ref) => refs.push(ref))

  return refs
}

describe('a sprite frame past the end of a row', () => {
  test('shows the last piece of a set drawn from one frame of its symbol', () => {
    expect(piecesShown([pistol], 'a_WeaponPistol', 0)).toEqual([0])
    expect(piecesShown([pistol], 'a_WeaponPistol', 7)).toEqual([0])
    expect(piecesShown([pistol], 'a_WeaponPistolRight', 30)).toEqual([1])
  })

  test("shows a class set's last frame", () => {
    const row = pickup.bones.a_OrbPickupFX

    expect(piecesShown([pickup], 'a_OrbPickupFX', 3)).toEqual([row[3]])
    expect(piecesShown([pickup], 'a_OrbPickupFX', 20)).toEqual([row[row.length - 1]])
  })

  test('shows nothing in a format 3 group', () => {
    const group = groupOfFormat(3, { a_Body: [4, 5] })

    expect(piecesShown([group], 'a_Body', 1)).toEqual([5])
    expect(piecesShown([group], 'a_Body', 2)).toEqual([])
  })

  test('shows nothing when the row ends on a frame without a piece', () => {
    const group = groupOfFormat(4, { a_Body: [4, -1] })

    expect(piecesShown([group], 'a_Body', 0)).toEqual([4])
    expect(piecesShown([group], 'a_Body', 5)).toEqual([])
  })

  test("keeps a format 4 group's last piece a candidate where a longer format 3 row goes on", () => {
    const groups = [groupOfFormat(3, { a_Body: [5, 6, 7] }), groupOfFormat(4, { a_Body: [2] })]
    const onlyTheSet = (ref: number) => groupOf(ref) === 1

    expect(piecesShown(groups, 'a_Body', 2)).toEqual([7])
    expect(piecesShown(groups, 'a_Body', 2, { isLoaded: onlyTheSet })).toEqual([PIECES + 2])
    expect(piecesShown(groups, 'a_Body', 9)).toEqual([PIECES + 2])
  })

  test("follows a weapon's own row in a format 4 group", () => {
    const group = groupOfFormat(4, { a_Hand: [1, 2] }, { Katar: { a_Hand: [3] } })

    expect(piecesShown([group], 'a_Hand', 6)).toEqual([2])
    expect(piecesShown([group], 'a_Hand', 6, { weapon: 'Katar' })).toEqual([3])
  })

  test("drops the base row's last piece where a format 3 weapon row replaces it", () => {
    const groups = [groupOfFormat(4, { a_Hand: [1] }), groupOfFormat(3, {}, { Katar: { a_Hand: [3] } })]

    expect(piecesShown(groups, 'a_Hand', 4)).toEqual([1])
    expect(piecesShown(groups, 'a_Hand', 0, { weapon: 'Katar' })).toEqual([PIECES + 3])
    expect(piecesShown(groups, 'a_Hand', 4, { weapon: 'Katar' })).toEqual([])
  })
})
