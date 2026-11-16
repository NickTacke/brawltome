// The files the brawlhalla-anims export writes for a replay line, which src/draw.ts loads in the browser. Paths inside
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

// soft lines are the platforms a player can drop through
export type LevelSegment = { fromX: number; fromY: number; toX: number; toY: number; isSoft: boolean }

// a piece of platform art: the file under the map route, where its top left goes, its drawn size and its turn in degrees
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
  layout: LevelLayout
}
