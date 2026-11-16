// Loads what the brawlhalla-anims export writes for a match, for src/draw.ts: the manifest, the art groups' piece
// tables, the animation packs and the sprite sheets. Browser only (createImageBitmap); no Node APIs.
//
// The manifest is the match's own file. Every path inside it (art/, sheets/, anims/, maps/) is relative to the art
// store's root, baseUrl, which is shared by every match and can live on another domain.
import { type ArtGroup, FORMAT, type Manifest, type ManifestArt, type ManifestPlayer } from './format.ts'
import { type Pack, readPack } from './pack.ts'
import { Animations, ArtSet, eachDraw, type Frame, groupOf, type Matrix, pieceOf } from './placement.ts'

export type Progress = {
  // bytes loaded so far
  loaded: number
  // bytes of every file the replay draws with
  total: number
  // whether the first seconds can be drawn
  started: boolean
}

export type LoadOptions = {
  // the art store's root, which the manifest's art/, sheets/, anims/ and maps/ paths are relative to
  baseUrl: string | URL
  onProgress?: (progress: Progress) => void
  fetch?: Fetch
  // aborting it stops the replay's downloads: loadReplay rejects if it hasn't resolved, and replay.loaded rejects
  // with the signal's reason (an AbortError) instead of loading the rest
  signal?: AbortSignal
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

const fetchOf = (options: LoadOptions): Fetch => options.fetch ?? ((url, init) => fetch(url, init))

// the shape of every path the export writes into a manifest: a folder of the store and a file named by its hash
const STORE_PATH = /^(art|sheets|anims|maps)\/[0-9a-f]+\.(json|bin|webp)$/

// how many sheets load at once after loadReplay resolves
const SHEETS_AT_ONCE = 4

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

type Group = { url: string; json: ArtGroup; sheets: (ImageBitmap | undefined)[] }

// Drawable is a player's (or the objects') animations, with the art they're drawn with
type Drawable = { animations: Animations; sets: Map<string, ArtSet>; ready: Map<string, boolean> }

export type PlayerAssets = Drawable & { slot: string; info: ManifestPlayer; set: ArtSet }
export type ObjectAssets = Drawable

export type Replay = {
  manifest: Manifest
  players: Map<string, PlayerAssets>
  objects?: ObjectAssets
  // settles once everything has loaded
  loaded: Promise<void>
  groups: Group[]
  // isLoaded says whether a piece's sheet has loaded
  isLoaded: (ref: number) => boolean
  // want moves a piece's sheet to the front of what's left to load
  want: (ref: number) => void
  // assetUrl is where one of the manifest's paths is, such as its map's layout or its background
  assetUrl: (path: string) => string
}

// storeRootOf is the art store's root as a folder, so a baseUrl written without its trailing slash keeps its last part
function storeRootOf(baseUrl: string | URL): URL {
  const root = new URL(baseUrl, globalThis.location?.href)

  if (!root.pathname.endsWith('/')) root.pathname = `${root.pathname}/`

  return root
}

async function fetchManifest(manifestUrl: string | URL, options: LoadOptions): Promise<Manifest> {
  const url = new URL(manifestUrl, globalThis.location?.href).href
  const signal = options.signal

  signal?.throwIfAborted()

  const response = await fetchOf(options)(url, { signal })

  signal?.throwIfAborted()

  if (!response.ok) throw new Error(`load replay ${url}: HTTP ${response.status}`)

  const manifest = (await response.json()) as Manifest

  if (manifest.format !== FORMAT) {
    throw new Error(`load replay ${url}: manifest format ${manifest.format}, expected ${FORMAT}`)
  }

  return manifest
}

// Store fetches a match's files from the art store and counts their bytes for progress
class Store {
  readonly manifest: Manifest
  started = false
  private readonly root: URL
  private readonly get: Fetch
  private readonly signal?: AbortSignal
  private readonly onProgress?: (progress: Progress) => void
  private readonly totalBytes: number
  private loadedBytes = 0

  constructor(manifest: Manifest, options: LoadOptions) {
    this.manifest = manifest
    this.root = storeRootOf(options.baseUrl)
    this.get = fetchOf(options)
    this.signal = options.signal
    this.onProgress = options.onProgress
    this.totalBytes = Object.values(manifest.bytes).reduce((total, bytes) => total + bytes, 0)
  }

  // urlOf is where a manifest path is in the art store. A path of another shape, or one that resolves outside the
  // store, is refused: a tampered manifest mustn't make the page fetch from anywhere else
  urlOf(path: string): string {
    const outside = new Error(`load replay file ${path}: outside the art store`)

    if (!STORE_PATH.test(path)) throw outside

    const url = new URL(path, this.root)

    if (url.origin !== this.root.origin || !url.pathname.startsWith(this.root.pathname)) throw outside

    return url.href
  }

  throwIfAborted() {
    this.signal?.throwIfAborted()
  }

  // progress counts a file in, by its path, and tells onProgress
  progress(path?: string) {
    if (path) this.loadedBytes += this.manifest.bytes[path] ?? 0

    this.onProgress?.({ loaded: this.loadedBytes, total: this.totalBytes, started: this.started })
  }

  async file(path: string): Promise<Response> {
    const url = this.urlOf(path)

    this.throwIfAborted()

    const response = await this.get(url, { signal: this.signal })

    // a response that arrives after the replay was abandoned is dropped, whatever fetch did with the signal
    this.throwIfAborted()

    if (!response.ok) throw new Error(`load replay file ${url}: HTTP ${response.status}`)

    return response
  }

  async json<T>(path: string): Promise<T> {
    const value = (await (await this.file(path)).json()) as T

    this.progress(path)

    return value
  }

  async pack(path: string): Promise<Pack> {
    const value = readPack(await (await this.file(path)).arrayBuffer())

    this.progress(path)

    return value
  }
}

// Sheets loads the sprite sheets: the ones asked for at once, then the rest from a queue a few at a time
class Sheets {
  private readonly store: Store
  private readonly groups: Group[]
  private readonly jobs = new Map<string, Promise<void>>()
  private queue: string[] = []

  constructor(store: Store, groups: Group[]) {
    this.store = store
    this.groups = groups
  }

  isLoaded = (ref: number): boolean => {
    const group = this.groups[groupOf(ref)]
    const piece = group?.json.pieces[pieceOf(ref)]

    return piece !== undefined && group?.sheets[piece[0]] !== undefined
  }

  sheetOf(ref: number): string | undefined {
    const group = this.groups[groupOf(ref)]
    const piece = group?.json.pieces[pieceOf(ref)]

    return piece && group?.json.sheets[piece[0]]?.src
  }

  load(src: string): Promise<void> {
    const job = this.jobs.get(src) ?? this.fetchSheet(src)

    this.jobs.set(src, job)

    return job
  }

  // want moves a piece's sheet to the front of the queue
  want = (ref: number) => {
    const src = this.sheetOf(ref)
    const at = src === undefined ? -1 : this.queue.indexOf(src)

    if (at > 0) this.queue.unshift(...this.queue.splice(at, 1))
  }

  // queueRest queues every sheet not asked for yet: those in order first, in it, then the others
  queueRest(order: string[]) {
    const every = new Set(this.groups.flatMap((group) => group.json.sheets.map((sheet) => sheet.src)))
    const inOrder = order.filter((src) => every.has(src))

    this.queue = [...new Set([...inOrder, ...every])].filter((src) => !this.jobs.has(src))
  }

  // loadQueued loads the queue a few sheets at a time, so the order holds whatever the connection
  async loadQueued() {
    const worker = async () => {
      for (let src = this.queue.shift(); src !== undefined; src = this.queue.shift()) await this.load(src)
    }

    await Promise.all(Array.from({ length: SHEETS_AT_ONCE }, worker))
  }

  private async fetchSheet(src: string) {
    const blob = await (await this.store.file(src)).blob()

    this.store.throwIfAborted()

    const bitmap = await createImageBitmap(blob)

    // a sheet two groups name is fetched and decoded once
    for (const group of this.groups) {
      group.json.sheets.forEach((sheet, index) => {
        if (sheet.src === src) group.sheets[index] ??= bitmap
      })
    }

    this.store.progress(src)
  }
}

// loadGroups loads every group's piece table first: they're small, and say which sheets the first seconds need
async function loadGroups(store: Store, arts: ManifestArt[]): Promise<Group[]> {
  const urls = [...new Set(arts.flatMap((art) => art.art))]
  const jsons = await Promise.all(urls.map((url) => store.json<ArtGroup>(url)))

  return jsons.map((json, index) => ({ url: urls[index], json, sheets: json.sheets.map(() => undefined) }))
}

// GroupTable finds a manifest art's groups among the replay's, and their tables
type GroupTable = { indexesOf: (art: ManifestArt) => number[]; jsonOf: (group: number) => ArtGroup }

function groupTableOf(groups: Group[]): GroupTable {
  const urls = groups.map((group) => group.url)

  return {
    indexesOf: (art) => art.art.map((url) => urls.indexOf(url)),
    jsonOf: (group) => groups[group].json,
  }
}

function playersOf(manifest: Manifest, table: GroupTable): Map<string, PlayerAssets> {
  const players = new Map<string, PlayerAssets>()

  for (const [slot, info] of Object.entries(manifest.players)) {
    const set = new ArtSet(table.indexesOf(info), table.jsonOf)
    const ready = new Map<string, boolean>()

    players.set(slot, { slot, info, set, sets: new Map([['', set]]), animations: new Animations(), ready })
  }

  return players
}

// objectsOf is the objects' art: a set per look, sharing their bones' ids
function objectsOf(art: ManifestArt | undefined, table: GroupTable): ObjectAssets | undefined {
  if (!art) return undefined

  const indexes = table.indexesOf(art)
  const names = new Map<string, number>()

  const sets = new Map(
    Object.entries(art.artByLook ?? {}).map(([look, at]) => {
      const groups = at.map((index) => indexes[index])

      return [look, new ArtSet(groups, table.jsonOf, names)] as const
    }),
  )

  return { sets, animations: new Animations(), ready: new Map() }
}

// addPack adds a pack's animations; its names are resolved against the sets it's drawn with, which share their bones'
// ids
function addPack(drawable: Drawable, pack: Pack) {
  const set = drawable.sets.values().next().value

  if (set) drawable.animations.add(pack, set)
}

// startFramesOf is every frame a player (or the objects, by look) shows in the first seconds, with the set it's drawn
// with
function startFramesOf(art: ManifestArt, drawable: Drawable): [ArtSet, Frame][] {
  const starts: [string, number[]][] = art.startByLook ? Object.entries(art.startByLook) : [['', art.startAnimations]]

  return starts.flatMap(([look, indexes]) => {
    const set = drawable.sets.get(look)

    if (!set) return []

    return indexes.flatMap((index) =>
      framesOf(drawable.animations, index).map((frame): [ArtSet, Frame] => [set, frame]),
    )
  })
}

function framesOf(animations: Animations, index: number): Frame[] {
  const frameNumbers = [...(animations.byIndex.get(index)?.animation.frames.keys() ?? [])]

  return frameNumbers.flatMap((frameNumber) => animations.frame(index, frameNumber) ?? [])
}

// firstSheetsOf is the sheets the first seconds draw: each start animation's pieces, the first candidate of each
function firstSheetsOf(drawables: [ManifestArt, Drawable][], sheets: Sheets): Set<string> {
  const firstSheets = new Set<string>()

  const addSheet = (ref: number) => {
    const src = sheets.sheetOf(ref)

    if (src !== undefined) firstSheets.add(src)

    return true
  }

  for (const [art, drawable] of drawables) {
    for (const [set, frame] of startFramesOf(art, drawable)) {
      for (const weapon of set.weapons()) eachDraw(set, weapon, frame, IDENTITY, addSheet)
    }
  }

  return firstSheets
}

// loadRest loads, in the background, the other animations, then every sheet in the order playback first needs it
async function loadRest(store: Store, drawables: [ManifestArt, Drawable][], sheets: Sheets) {
  await Promise.all(
    drawables.map(async ([art, drawable]) => {
      if (art.rest) addPack(drawable, await store.pack(art.rest))
    }),
  )

  await sheets.loadQueued()
}

// loadReplay loads a manifest and resolves once the players and objects the match's first seconds show
// (manifest.start) can be drawn completely; the rest goes on loading, and replay.loaded settles when it's done
export async function loadReplay(manifestUrl: string | URL, options: LoadOptions): Promise<Replay> {
  const manifest = await fetchManifest(manifestUrl, options)
  const store = new Store(manifest, options)

  const arts = [...Object.values(manifest.players), ...(manifest.objects ? [manifest.objects] : [])]
  const groups = await loadGroups(store, arts)
  const table = groupTableOf(groups)
  const players = playersOf(manifest, table)
  const objects = objectsOf(manifest.objects, table)

  const drawables: [ManifestArt, Drawable][] = [...players.values()].map((player) => [player.info, player])

  if (manifest.objects && objects) drawables.push([manifest.objects, objects])

  await Promise.all(drawables.map(async ([art, drawable]) => addPack(drawable, await store.pack(art.start))))

  const sheets = new Sheets(store, groups)

  await Promise.all([...firstSheetsOf(drawables, sheets)].map((src) => sheets.load(src)))
  store.started = true
  store.progress()

  // a sheet something failed to draw for moves to the front of the queue (want)
  sheets.queueRest(manifest.sheetOrder)
  const loaded = loadRest(store, drawables, sheets)

  return {
    manifest,
    players,
    objects,
    loaded,
    groups,
    isLoaded: sheets.isLoaded,
    want: sheets.want,
    assetUrl: (path) => store.urlOf(path),
  }
}
