import { type ArtFileKind, parseArtPath } from './art-paths'

// a match's manifest comes from the replay worker and names the art files the page loads. it is stored only when
// every file it names is a valid art path the bucket already holds. the shape is the brawlhalla-anims export's
// format 3 or 4, as packages/replay-player/src/format.ts reads it (Manifest, ManifestFormat4, ManifestArt). format 4
// adds each player's looks, which name the player's art groups by index, so they name no file of their own

export const MANIFEST_FORMATS: readonly number[] = [3, 4]

const LOOKS_FORMAT = 4

type NamedPath = { where: string; value: unknown; kind: ArtFileKind | 'any' }

/** Every art file a manifest names, or why it isn't a manifest this API stores. */
export function readManifestPaths(manifest: unknown): { paths: string[] } | { reason: string } {
  if (!isRecord(manifest)) return { reason: 'the manifest is not a json object' }

  if (!MANIFEST_FORMATS.includes(manifest.format as number)) {
    return { reason: `the manifest has format ${String(manifest.format)}, not ${MANIFEST_FORMATS.join(' or ')}` }
  }

  const named = namedPaths(manifest)

  if (!named) return { reason: 'the manifest lacks its map, players, sheet order or sizes' }

  const wrongLooks = manifest.format === LOOKS_FORMAT ? playerWithoutLooks(manifest.players) : null

  if (wrongLooks) return { reason: `the manifest's players.${wrongLooks}.looks are not looks at its art` }

  const wrong = named.find(({ value, kind }) => !isArtPath(value, kind))

  if (wrong) return { reason: `the manifest's ${wrong.where} is not a ${wrong.kind} file path` }

  return { paths: [...new Set(named.map(({ value }) => value as string))] }
}

function namedPaths(manifest: Record<string, unknown>): NamedPath[] | null {
  const { map, players, sheetOrder, bytes, background, objects } = manifest

  if (!isRecord(map) || !isRecord(players) || !Array.isArray(sheetOrder) || !isRecord(bytes)) return null

  const artSections = Object.entries(players).map(([slot, player]) => artPaths(`players.${slot}`, player))

  if (objects !== undefined) artSections.push(artPaths('objects', objects))

  if (artSections.includes(null)) return null

  return [
    { where: 'map.layout', value: map.layout, kind: 'map' },
    ...(background === undefined ? [] : [backgroundPath(background)]),
    ...sheetOrder.map((value, index): NamedPath => ({ where: `sheetOrder.${index}`, value, kind: 'sheet' })),
    // sizes by path, which also name the sheets the art groups draw from
    ...Object.keys(bytes).map((value): NamedPath => ({ where: `bytes key ${value}`, value, kind: 'any' })),
    ...artSections.flatMap((section) => section ?? []),
  ]
}

function backgroundPath(background: unknown): NamedPath {
  return { where: 'background.asset', value: isRecord(background) ? background.asset : null, kind: 'sheet' }
}

// a player's or the objects' art groups and their two animation packs; artByLook only holds indexes into art
function artPaths(where: string, art: unknown): NamedPath[] | null {
  if (!isRecord(art) || !Array.isArray(art.art)) return null

  const groups = art.art.map((value, index): NamedPath => ({ where: `${where}.art.${index}`, value, kind: 'art' }))
  const start: NamedPath = { where: `${where}.start`, value: art.start, kind: 'anim' }

  if (art.rest === undefined) return [...groups, start]

  return [...groups, start, { where: `${where}.rest`, value: art.rest, kind: 'anim' }]
}

// the slot of a format 4 player whose looks aren't a list of looks drawn from its own art groups, or null. namedPaths
// has found each player an object with a list of art
function playerWithoutLooks(players: unknown): string | null {
  const entries = Object.entries(players as Record<string, Record<string, unknown>>)
  const wrong = entries.find(([, player]) => !areLooksAt(player.looks, (player.art as unknown[]).length))

  return wrong ? wrong[0] : null
}

// a look as the page reads it (lookProblem in packages/replay-player/src/read.ts), so a manifest the page would refuse
// fails the art job instead of being stored
function areLooksAt(looks: unknown, groupCount: number): boolean {
  if (!Array.isArray(looks)) return false

  return looks.every((look) => isLookAt(look, groupCount))
}

function isLookAt(look: unknown, groupCount: number): boolean {
  if (!isRecord(look) || typeof look.weapon !== 'string') return false

  if (look.look !== undefined && !isIndex(look.look)) return false

  return areGroupsAt(look.art, groupCount) && areSwaps(look.swaps)
}

function areGroupsAt(art: unknown, groupCount: number): boolean {
  if (!Array.isArray(art)) return false

  return art.every((group) => isIndex(group) && group < groupCount)
}

function areSwaps(swaps: unknown): boolean {
  if (!Array.isArray(swaps)) return false

  return swaps.every(isSwap)
}

// a swap is [from, to, art type]
function isSwap(swap: unknown): boolean {
  if (!Array.isArray(swap) || swap.length !== 3) return false

  return swap.every((value) => Number.isInteger(value))
}

function isIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isArtPath(value: unknown, kind: NamedPath['kind']): boolean {
  if (typeof value !== 'string') return false

  const parsed = parseArtPath(value)

  if (!parsed) return false

  return kind === 'any' || parsed.kind === kind
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
