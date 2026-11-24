// Loads what the brawlhalla-anims export writes for a match, for src/draw.ts: the manifest, the art groups' piece
// tables, the animation packs and the sprite sheets. Browser only (createImageBitmap); no Node APIs.
//
// The manifest is the match's own file. Every path inside it (art/, sheets/, anims/, maps/) is relative to the art
// store's root, baseUrl, which is shared by every match and can live on another domain.
import { composeSheet, decodeImages, type WeightedImages } from './compose-sheet.ts'
import {
  type AnyArtGroup,
  type AnyManifest,
  type ManifestArt,
  type ManifestPlayer,
  type ManifestPlayerFormat4,
  SET_FORMAT,
  type SetSheet,
} from './format.ts'
import {
  coloredPiecesOf,
  compositionKeyOf,
  type Group,
  Groups,
  isSetGroup,
  isWeighted,
  type WeightedSheet,
} from './groups.ts'
import { type Pack, readPack } from './pack.ts'
import { Animations, ArtSet, eachDraw, type Frame, groupOf, type Matrix, pieceOf } from './placement.ts'
import { readArtGroup, readManifest } from './read.ts'

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

// Drawable is a player's (or the objects') animations, with the art they're drawn with
type Drawable = { animations: Animations; sets: Map<string, ArtSet>; ready: Map<string, boolean> }

// a player's sets are by look: "" for a format 3 player's only one, or the index into their manifest looks. set is
// the first
export type PlayerAssets = Drawable & { slot: string; info: ManifestPlayer | ManifestPlayerFormat4; set: ArtSet }
export type ObjectAssets = Drawable

export type Replay = {
  manifest: AnyManifest
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

async function fetchManifest(manifestUrl: string | URL, options: LoadOptions): Promise<AnyManifest> {
  const url = new URL(manifestUrl, globalThis.location?.href).href
  const signal = options.signal

  signal?.throwIfAborted()

  const response = await fetchOf(options)(url, { signal })

  signal?.throwIfAborted()

  if (!response.ok) throw new Error(`load replay ${url}: HTTP ${response.status}`)

  return readManifest(await response.json(), url)
}

// Store fetches a match's files from the art store and counts their bytes for progress
class Store {
  readonly manifest: AnyManifest
  started = false
  private readonly root: URL
  private readonly get: Fetch
  private readonly signal?: AbortSignal
  private readonly onProgress?: (progress: Progress) => void
  private totalBytes: number
  private loadedBytes = 0
  // the sizes of the files a manifest's bytes don't list: a set's sheets, which its file gives
  private readonly expected = new Map<string, number>()

  constructor(manifest: AnyManifest, options: LoadOptions) {
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

  // expect counts a file the manifest doesn't list into the total, once it's to be loaded
  expect(path: string, bytes: number) {
    if (path in this.manifest.bytes || this.expected.has(path)) return

    this.expected.set(path, bytes)
    this.totalBytes += bytes
  }

  // progress counts a file in, by its path, and tells onProgress
  progress(path?: string) {
    if (path) this.loadedBytes += this.manifest.bytes[path] ?? this.expected.get(path) ?? 0

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

  async artGroup(path: string): Promise<AnyArtGroup> {
    const value = readArtGroup(await (await this.file(path)).json(), this.urlOf(path))

    this.progress(path)

    return value
  }

  async pack(path: string): Promise<Pack> {
    const value = readPack(await (await this.file(path)).arrayBuffer())

    this.progress(path)

    return value
  }
}

// Sheets loads the sprite sheets: the ones asked for at once, then the rest from a queue a few at a time. A weighted
// sheet loads with its weight sheets and is composed once in each colouring its groups give it
class Sheets {
  private readonly store: Store
  private readonly groups: Group[]
  private readonly jobs = new Map<string, Promise<void>>()
  // composed sheets by compositionKeyOf, so groups in the same colours share one
  private readonly composed = new Map<string, Promise<ImageBitmap>>()
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

  // queueRest queues every sheet not asked for yet but a set's: those in order first, in it, then the others. A set
  // holds far more than a match draws, so its sheets wait for queueDrawn
  queueRest(order: string[]) {
    const whole = this.groups.filter((group) => !isSetGroup(group.json))
    const every = new Set(whole.flatMap((group) => group.json.sheets.map((sheet) => sheet.src)))
    const inOrder = order.filter((src) => every.has(src))

    this.queue = [...new Set([...inOrder, ...every])].filter((src) => !this.jobs.has(src))
  }

  // queueDrawn queues, after the rest, the sets' sheets the match draws from
  queueDrawn(sources: string[]) {
    const queued = new Set(this.queue)

    for (const src of sources) {
      if (this.jobs.has(src) || queued.has(src)) continue

      this.expect(src)
      this.queue.push(src)
    }
  }

  // expect counts a sheet and its weight sheets into the bytes to load, where the manifest doesn't list them
  expect(src: string) {
    const sheet = this.sheetNamed(src)

    if (!sheet) return

    this.store.expect(src, sheet.bytes)

    for (const weight of sheet.weights ?? []) this.store.expect(weight.src, weight.bytes)
  }

  // loadQueued loads the queue a few sheets at a time, so the order holds whatever the connection
  async loadQueued() {
    const worker = async () => {
      for (let src = this.queue.shift(); src !== undefined; src = this.queue.shift()) await this.load(src)
    }

    await Promise.all(Array.from({ length: SHEETS_AT_ONCE }, worker))
  }

  private sheetNamed(src: string): SetSheet | undefined {
    for (const group of this.groups) {
      const sheets: SetSheet[] = group.json.sheets
      const sheet = sheets.find((candidate) => candidate.src === src)

      if (sheet) return sheet
    }

    return undefined
  }

  private fetchSheet(src: string): Promise<void> {
    const sheet = this.sheetNamed(src)

    return isWeighted(sheet) ? this.fetchWeighted(sheet) : this.fetchPlain(src)
  }

  private async fetchPlain(src: string) {
    const blob = await (await this.store.file(src)).blob()

    this.store.throwIfAborted()

    const bitmap = await createImageBitmap(blob)

    // decoding takes a while; a replay abandoned meanwhile keeps nothing and reports nothing
    this.store.throwIfAborted()

    // a sheet two groups name is fetched and decoded once
    for (const group of this.groups) {
      group.json.sheets.forEach((sheet, index) => {
        if (sheet.src === src) group.sheets[index] ??= bitmap
      })
    }

    this.store.progress(src)
  }

  // fetchWeighted loads a weighted sheet and its weight sheets, and gives each group that has it the sheet in its
  // colours. The decoded sheets, and their pixels once read, are shared by every colouring and let go once all are
  // composed
  private async fetchWeighted(sheet: WeightedSheet) {
    const paths = [sheet.src, ...sheet.weights.map((weight) => weight.src)]
    const [base, ...weights] = await Promise.all(paths.map(async (path) => (await this.store.file(path)).blob()))

    this.store.throwIfAborted()

    const images = await decodeImages(base, weights)

    try {
      await this.composeFor(sheet.src, images)
    } finally {
      images.close()
    }

    for (const path of paths) this.store.progress(path)
  }

  private async composeFor(src: string, images: WeightedImages) {
    for (const group of this.groups) {
      for (const [index, sheet] of group.json.sheets.entries()) {
        if (sheet.src !== src || group.sheets[index]) continue

        const bitmap = await this.composedIn(group, index, images)

        // a replay abandoned while composing keeps nothing
        this.store.throwIfAborted()
        group.sheets[index] ??= bitmap
      }
    }
  }

  private composedIn(group: Group, index: number, images: WeightedImages): Promise<ImageBitmap> {
    const pieces = coloredPiecesOf(group, index)
    const key = compositionKeyOf(group.json.sheets[index].src, pieces)
    const known = this.composed.get(key)

    if (known) return known

    const composed = composeSheet(images, pieces)

    this.composed.set(key, composed)

    return composed
  }
}

// loadGroups loads every group's piece table first: they're small, and say which sheets the first seconds need
async function loadGroups(store: Store, manifest: AnyManifest): Promise<Map<string, AnyArtGroup>> {
  const arts = [...Object.values(manifest.players), ...(manifest.objects ? [manifest.objects] : [])]
  const urls = [...new Set(arts.flatMap((art) => art.art))]
  const jsons = await Promise.all(urls.map((url) => store.artGroup(url)))

  return new Map(urls.map((url, index) => [url, jsons[index]]))
}

function playersOf(manifest: AnyManifest, groups: Groups): Map<string, PlayerAssets> {
  const players = new Map<string, PlayerAssets>()

  for (const [slot, info] of Object.entries(manifest.players)) {
    if (manifest.format === SET_FORMAT) {
      players.set(slot, playerByLooks(slot, info as ManifestPlayerFormat4, groups))

      continue
    }

    const set = new ArtSet(
      info.art.map((url) => groups.indexOf(url)),
      groups.jsonOf,
    )

    players.set(slot, playerOf(slot, info, set, new Map([['', set]])))
  }

  return players
}

function playerOf(slot: string, info: PlayerAssets['info'], set: ArtSet, sets: Map<string, ArtSet>): PlayerAssets {
  return { slot, info, set, sets, animations: new Animations(), ready: new Map() }
}

// playerByLooks is a format 4 player: a set per look, sharing their bones' ids, each look's groups in its colours. A
// player with no looks draws nothing
function playerByLooks(slot: string, info: ManifestPlayerFormat4, groups: Groups): PlayerAssets {
  const names = new Map<string, number>()

  const lookSets = info.looks.map((look) => {
    const lookGroups = look.art.map((art) => groups.indexOf(info.art[art], look.swaps))

    return new ArtSet(lookGroups, groups.jsonOf, names)
  })

  const first = lookSets[0] ?? new ArtSet([], groups.jsonOf)

  return playerOf(slot, info, first, new Map(lookSets.map((set, index) => [String(index), set])))
}

// objectsOf is the objects' art: a set per look, sharing their bones' ids
function objectsOf(art: ManifestArt | undefined, groups: Groups): ObjectAssets | undefined {
  if (!art) return undefined

  const indexes = art.art.map((url) => groups.indexOf(url))
  const names = new Map<string, number>()

  const sets = new Map(
    Object.entries(art.artByLook ?? {}).map(([look, at]) => {
      const lookGroups = at.map((index) => indexes[index])

      return [look, new ArtSet(lookGroups, groups.jsonOf, names)] as const
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

// setsOf is each set a drawable has, once
const setsOf = (drawable: Drawable) => [...new Set(drawable.sets.values())]

// startFramesOf is every frame a player (in each of their looks) or the objects (by look) show in the first seconds,
// with the set it's drawn with
function startFramesOf(art: ManifestArt, drawable: Drawable): [ArtSet, Frame][] {
  const starts: [ArtSet | undefined, number[]][] = art.startByLook
    ? Object.entries(art.startByLook).map(([look, indexes]) => [drawable.sets.get(look), indexes])
    : setsOf(drawable).map((set) => [set, art.startAnimations])

  return starts.flatMap(([set, indexes]) => {
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

// sheetsDrawn collects the sheets a frame of a set draws, the first candidate of each piece
function sheetsDrawn(set: ArtSet, frame: Frame, sheets: Sheets, into: Set<string>) {
  const addSheet = (ref: number) => {
    const src = sheets.sheetOf(ref)

    if (src !== undefined) into.add(src)

    return true
  }

  for (const weapon of set.weapons()) eachDraw(set, weapon, frame, IDENTITY, addSheet)
}

// firstSheetsOf is the sheets the first seconds draw: each start animation's pieces, the first candidate of each
function firstSheetsOf(drawables: [ManifestArt, Drawable][], sheets: Sheets): Set<string> {
  const firstSheets = new Set<string>()

  for (const [art, drawable] of drawables) {
    for (const [set, frame] of startFramesOf(art, drawable)) sheetsDrawn(set, frame, sheets, firstSheets)
  }

  return firstSheets
}

// setSheetsDrawnOf is the sets' sheets the match draws from: those any frame of the packs shows, in any look
function setSheetsDrawnOf(drawables: Drawable[], groups: Group[], sheets: Sheets): string[] {
  const drawn = new Set<string>()
  const isSet = (group: number) => isSetGroup(groups[group].json)

  for (const drawable of drawables) {
    for (const set of setsOf(drawable)) {
      if (!set.groups.some(isSet)) continue

      for (const index of drawable.animations.byIndex.keys()) {
        for (const frame of framesOf(drawable.animations, index)) sheetsDrawn(set, frame, sheets, drawn)
      }
    }
  }

  // the other groups' sheets are queued already
  return [...drawn]
}

// loadRest loads, in the background, the other animations, then every sheet in the order playback first needs it, then
// the sets' sheets the animations draw from
async function loadRest(store: Store, drawables: [ManifestArt, Drawable][], sheets: Sheets, groups: Group[]) {
  await Promise.all(
    drawables.map(async ([art, drawable]) => {
      if (art.rest) addPack(drawable, await store.pack(art.rest))
    }),
  )

  sheets.queueDrawn(
    setSheetsDrawnOf(
      drawables.map(([, drawable]) => drawable),
      groups,
      sheets,
    ),
  )

  await sheets.loadQueued()
}

// loadReplay loads a manifest and resolves once the players and objects the match's first seconds show
// (manifest.start) can be drawn completely; the rest goes on loading, and replay.loaded settles when it's done
export async function loadReplay(manifestUrl: string | URL, options: LoadOptions): Promise<Replay> {
  const manifest = await fetchManifest(manifestUrl, options)
  const store = new Store(manifest, options)

  const groups = new Groups(await loadGroups(store, manifest))
  const players = playersOf(manifest, groups)
  const objects = objectsOf(manifest.objects, groups)

  const drawables: [ManifestArt, Drawable][] = [...players.values()].map((player) => [player.info, player])

  if (manifest.objects && objects) drawables.push([manifest.objects, objects])

  await Promise.all(drawables.map(async ([art, drawable]) => addPack(drawable, await store.pack(art.start))))

  const sheets = new Sheets(store, groups.list)
  const firstSheets = [...firstSheetsOf(drawables, sheets)]

  for (const src of firstSheets) sheets.expect(src)

  await Promise.all(firstSheets.map((src) => sheets.load(src)))
  store.started = true
  store.progress()

  // a sheet something failed to draw for moves to the front of the queue (want)
  sheets.queueRest(manifest.sheetOrder)
  const loaded = loadRest(store, drawables, sheets, groups.list)

  return {
    manifest,
    players,
    objects,
    loaded,
    groups: groups.list,
    isLoaded: sheets.isLoaded,
    want: sheets.want,
    assetUrl: (path) => store.urlOf(path),
  }
}
