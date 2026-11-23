// dumpArtSet writes out what an ArtSet looks a piece up in: for each weapon table, each bone's candidates per sprite
// frame, so a test can compare two ways of reading the same groups
import type { ArtGroup } from '../src/format.ts'
import type { ArtSet } from '../src/placement.ts'

export type ArtSetDump = Record<string, Record<string, number[]>>

// boneNamesOf is every bone the groups draw, with or without a weapon skin, sorted
export function boneNamesOf(groups: ArtGroup[]): string[] {
  const names = new Set<string>()

  for (const group of groups) {
    for (const name of Object.keys(group.bones)) names.add(name)

    for (const bones of Object.values(group.weapons)) for (const name of Object.keys(bones)) names.add(name)
  }

  return [...names].sort()
}

export function dumpArtSet(set: ArtSet, boneNames: string[]): ArtSetDump {
  const dump: ArtSetDump = {}

  for (const weapon of set.weapons()) {
    const rows: Record<string, number[]> = {}

    for (const name of boneNames) {
      const row = set.pieces(weapon, set.nameId(name))

      if (row) rows[name] = Array.from(row)
    }

    dump[weapon] = rows
  }

  return dump
}
