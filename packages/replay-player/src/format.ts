// The files the brawlhalla-anims export writes for a replay line, which src/load.ts loads in the browser. Paths inside
// them are relative to the art store's root, the baseUrl loadReplay is given
export const FORMAT = 3

export type Rect = { x: number; y: number; width: number; height: number }

// Manifest is one per line, and the only file named by the match; every other file is shared by the matches that draw
// the same thing
export type Manifest = {
  format: typeof FORMAT
  replay: string
  patch: string
  // layout is the map's file, maps/<fingerprint>.json (MapFile)
  map: { id: number; name: string; layout: string }
  // the level's CameraBounds, which src/camera.ts plays the game's camera in, and the box around its collision lines
  // (cameraTrack's floor)
  cameraBounds?: Rect
  cameraFloor?: Rect
  // the height of each weapon and crate art class the line draws (cameraTrack's itemHeights)
  itemHeights?: Record<string, number>
  // the level's background image (a sheets/<hash>.webp), under the level and fixed to the screen (src/camera.ts
  // backgroundToCanvas)
  background?: { asset: string; width: number; height: number }
  // the line's timeline.animations and timeline.objectAnimations, for reference: [class, name] by index; the objects'
  // can have the off-screen bubble's after them
  animations: [string, string][]
  objectAnimations: [string, string][]
  // the off-screen bubble's animation among the objects' (src/offscreen.ts), drawn with no look ("-"); it follows the
  // line's own objectAnimations, in an export that has it
  offscreenBubble?: number
  // the steps loadReplay makes drawable before it resolves: the match's first seconds
  start: { from: number; to: number }
  // every sheet, in the order playback first shows something drawn from it: the order the loader fetches the rest in
  sheetOrder: string[]
  players: Record<string, ManifestPlayer>
  objects?: ManifestArt
  // every file's size in bytes, by path, for progress
  bytes: Record<string, number>
}

// ManifestArt is what one player (or the objects) draws with: art groups, and the animation data in two packs, the
// animations shown in the first seconds and the rest. The first group holds just what the first seconds draw, so they
// can be drawn before the rest has loaded
export type ManifestArt = {
  // art/<fingerprint>.json, in the order a bone's piece is looked up in; the first is the first seconds' group
  art: string[]
  // for objects, the art groups by look ("-" for none, or the index into the line's timeline.objectLooks)
  artByLook?: Record<string, number[]>
  // anims/<hash>.bin
  start: string
  rest?: string
  startAnimations: number[]
  // for objects, the animations each look shows in the first seconds
  startByLook?: Record<string, number[]>
}

export type ManifestPlayer = ManifestArt & {
  slot: number
  name: string
  legend: { id: number; name: string }
  look: { skin: number; colorScheme: number; weaponSkins: number[] }
}

// PieceRow is one piece of art in a group: its sheet, its rectangle there in pixels, and the rectangle it covers in the
// bone's own units: [sheet, sx, sy, sw, sh, x, y, w, h]
export type PieceRow = [number, number, number, number, number, number, number, number, number]

// ArtGroup is art/<fingerprint>.json: pieces baked into sprite sheets, and which piece each bone shows at each sprite
// frame (-1 for none). Named by the fingerprint of what it's made from, so the same look's group in another match, or
// another patch with the same files, is the same file. A sheet is sheets/<hash>.webp, named by its content; bytes is
// its size
export type ArtGroup = {
  format: typeof FORMAT
  sheets: { src: string; w: number; h: number; bytes: number }[]
  pieces: PieceRow[]
  // bone name -> piece per sprite frame (0-based), without a weapon skin; a timeline animation's frames are under "$"
  // and its symbol
  bones: Record<string, number[]>
  // per held weapon ("Scythe"), the bones that look different with that weapon's skin
  weapons: Record<string, Record<string, number[]>>
}

// Format 4 is the pre-drawn art's: each skin and weapon skin drawn once per patch as a set, and the player classes'
// own art in sets of the bones each animation is the first to show, which a match's manifest names instead of drawing
// its players' art. A reader takes formats 3 and 4, and a format 4 manifest may list format 3 groups
export const SET_FORMAT = 4

// the formats src/load.ts reads
export const FORMATS: readonly number[] = [FORMAT, SET_FORMAT]

// SetKind is what a set is drawn for: a costumeTypes.csv row, a weaponSkinTypes.csv row, or player classes' own art
export type SetKind = 'skin' | 'weaponSkin' | 'class'

// SetSheet is a format 4 group's sheet. A sheet with weights is lossless, its swappable fills drawn black, and each
// weight sheet is the same size: a piece's colour k (0-based) is channel k % 3 of weights[floor(k / 3)], how much of
// the pixel that colour covers times 255. A sheet holds pieces with weights or pieces without, never both
export type SetSheet = { src: string; w: number; h: number; bytes: number; weights?: { src: string; bytes: number }[] }

// ArtGroupFormat4 is art/<fingerprint>.json in format 4: a set, or a match's own group beside sets. A sprite frame
// past the end of a bone's row shows the row's last piece
export type ArtGroupFormat4 = {
  format: typeof SET_FORMAT
  sheets: SetSheet[]
  pieces: PieceRow[]
  bones: Record<string, number[]>
  // {} in a set: a weapon skin's art is a set of its own
  weapons: Record<string, Record<string, number[]>>
  // no row's id: rows that draw the same pieces share a set
  set?: { kind: SetKind; drawing: number }
  // per piece: [art type, colour, colour, ...], the colours its weights are for in the order of its weights, or []
  // when no colour rule reaches it
  swappable?: number[][]
}

// AnyArtGroup is an art group of either format, as a reader takes them
export type AnyArtGroup = ArtGroup | ArtGroupFormat4

// ManifestLook is one look a player has in a match: the held weapon, the index into the line's playerLooks when it
// records them, the player's art groups it's drawn from in lookup order (weapon skin set, skin set, class sets, then
// the match's own groups), and its swaps, [from, to, art type], in the game's order
export type ManifestLook = { weapon: string; look?: number; art: number[]; swaps: [number, number, number][] }

export type ManifestPlayerFormat4 = ManifestPlayer & { looks: ManifestLook[] }

// ManifestFormat4 is format 3 with each player's looks. bytes and sheetOrder cover only the match's own files: a set's
// file gives its sheets' sizes
export type ManifestFormat4 = Omit<Manifest, 'format' | 'players'> & {
  format: typeof SET_FORMAT
  players: Record<string, ManifestPlayerFormat4>
}

// AnyManifest is a manifest of either format, as a reader takes them
export type AnyManifest = Manifest | ManifestFormat4

// SetPath is where a set is stored: art/<fingerprint>.json
export type SetPath = `art/${string}.json`

// DRAW_PER_LOOK is the index's word for a row whose art no set can draw: a match draws its looks as it does without
// sets
export const DRAW_PER_LOOK = 'draw per look'

// NOTHING_TO_DRAW is the index's word for a row or a class set whose art draws nothing, so it needs no set
export const NOTHING_TO_DRAW = 'nothing to draw'

export type SetName = SetPath | typeof DRAW_PER_LOOK | typeof NOTHING_TO_DRAW

// ClassSetName is a class set in the index: the bones whose own art it holds, and its name
export type ClassSetName = { set: SetName; bones: string[] }

// SetIndex is sets/<32 hex of its SHA-256>.json: the name of every set of a patch, by CostumeID and WeaponSkinID, and
// the class sets by class and then by the animation that's the first to show their bones. game is the SHA-256 of the
// patch's BrawlhallaAir.swf. The replay worker reads it; a manifest names the sets themselves
export type SetIndex = {
  format: typeof SET_FORMAT
  drawing: number
  pixelsPerUnit: number
  patch: string
  game: string
  skins: Record<string, SetName>
  weaponSkins: Record<string, SetName>
  classes: Record<string, Record<string, ClassSetName>>
}

// soft lines are the platforms a player can drop through
export type LevelSegment = { fromX: number; fromY: number; toX: number; toY: number; isSoft: boolean }

// a piece of platform art: the file under the map route, where its top left goes, its drawn size and its turn in degrees
// about that corner. A negative width or height mirrors the image, which then reaches left of x or above y
export type LevelArt = { file: string; x: number; y: number; width: number; height: number; rotation: number }

// LevelLayout is a stage as the game lays it out, in level units: what a page needs to draw it
export type LevelLayout = {
  // what the game's camera shows of the stage
  camera: Rect
  // a player who leaves this box is out; the drawing covers exactly this
  killBounds: Rect
  collisions: LevelSegment[]
  art: LevelArt[]
  background: string | null
}

// MapFile is maps/<fingerprint>.json: a level as the replay draws it and the camera plays in it, for one patch
export type MapFile = {
  format: typeof FORMAT
  mapId: number
  patch: string
  cameraBounds: Rect
  // the box around the level's collision lines, which the camera takes as its floor (cameraTrack); the two are the
  // same box, under the camera's name and the level's
  cameraFloor: Rect | null
  collisionBounds: Rect | null
  // the background image as a sheets/<hash>.webp, at the size the level gives it
  background: { asset: string; width: number; height: number } | null
  // each platform art file the layout draws (layout.art's file) as a sheets/<hash>.webp, at the image's own size. A
  // file the game folder lacked isn't here, and its pieces aren't drawn; exports before platform art have none
  artAssets?: Record<string, string>
  layout: LevelLayout
}
