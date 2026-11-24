import { parseArtPath } from './art-paths'

// a patch's set index (sets/<sha256>.json) comes from the replay worker's predraw job and names every pre-drawn set of
// the patch: by skin id, by weapon skin id, and by player class and animation (SetIndex in the brawlhalla-anims
// export's src/format.ts). it is kept as the patch's index only when every set it names is in the art bucket

// the index's words for a row that needs no set of its own
const NOT_A_SET = ['nothing to draw', 'draw per look']

export type SetIndex = { patch: string; format: number; sets: string[] }

/** The patch an index is for, the format of its sets and every set it names, once each, or why it isn't a set index. */
export function readSetIndex(index: unknown): SetIndex | { reason: string } {
  if (!isRecord(index)) return { reason: 'the set index is not a json object' }

  if (typeof index.patch !== 'string') return { reason: 'the set index names no patch' }

  if (!isFormat(index.format)) return { reason: 'the set index names no set format' }

  const { skins, weaponSkins, classes } = index

  if (!isRecord(skins) || !isRecord(weaponSkins) || !isRecord(classes)) {
    return { reason: 'the set index lacks its skins, weapon skins or classes' }
  }

  const classNames = classSetNames(classes)

  if (!classNames) return { reason: "the set index's classes are not sets by class and animation" }

  const names = [...Object.values(skins), ...Object.values(weaponSkins), ...classNames]
  const wrong = names.find((name) => !isSetName(name))

  if (wrong !== undefined) return { reason: `the set index names ${String(wrong).slice(0, 100)}, not a set` }

  const sets = (names as string[]).filter((name) => !NOT_A_SET.includes(name))

  return { patch: index.patch, format: index.format, sets: [...new Set(sets)] }
}

// a format fits the smallint it is kept in, as the worker's reported formats do
function isFormat(format: unknown): format is number {
  return Number.isInteger(format) && (format as number) >= 1 && (format as number) <= 32767
}

// each class set's name, or null when classes isn't { class: { animation: { set, bones } } }
function classSetNames(classes: Record<string, unknown>): unknown[] | null {
  const names: unknown[] = []

  for (const animations of Object.values(classes)) {
    if (!isRecord(animations)) return null

    for (const classSet of Object.values(animations)) {
      if (!isRecord(classSet)) return null

      names.push(classSet.set)
    }
  }

  return names
}

// a set's path (art/<fingerprint>.json), or one of the index's words for a row without a set
function isSetName(name: unknown): boolean {
  if (typeof name !== 'string') return false

  return NOT_A_SET.includes(name) || parseArtPath(name)?.kind === 'art'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
