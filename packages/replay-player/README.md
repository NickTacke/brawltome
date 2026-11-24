# @brawltome/replay-player

Draws a match replay on a 2D canvas: the real legends in their skins, the game's camera, the colours the game tints
players with, and the bubble for a player out of view. It runs in the browser and has no Node APIs.

It draws what the replay export (brawlhalla-anims, run on the replay worker) writes for a match: a manifest per match,
and art shared by every match in an art store (`art/`, `sheets/`, `anims/`, `maps/`). The timeline it reads is the
match's bh-native replay line.

## Use

```ts
import {
  cameraAt,
  cameraOptions,
  cameraTrack,
  drawObject,
  drawPlayer,
  loadReplay,
  objectsAt,
  poseAt,
  viewToCanvas,
} from '@brawltome/replay-player'

// resolves once the match's first seconds can be drawn whole; the rest keeps loading
const replay = await loadReplay(manifestUrl, { baseUrl: 'https://art.example/', onProgress })
const camera = cameraTrack(line.timeline, replay.manifest.cameraBounds, cameraOptions(replay.manifest))

// each animation frame, at a step (fractional between steps):
const levelToCanvas = viewToCanvas(cameraAt(camera, step), canvas.width, canvas.height)
const objects = replay.objects ? objectsAt(line.timeline, step, (i) => replay.objects.animations.frameCount(i)) : []

for (const object of objects) if (object.behind) drawObject(ctx, replay, object, levelToCanvas)

for (const [slot, player] of replay.players) {
  const pose = poseAt(line.timeline, slot, step, (i) => player.animations.frameCount(i))

  if (pose) drawPlayer(ctx, replay, player, pose, levelToCanvas)
}

for (const object of objects) if (!object.behind) drawObject(ctx, replay, object, levelToCanvas)
```

- `loadReplay(manifestUrl, { baseUrl, onProgress?, fetch?, signal? })` fetches the manifest, then every art group's
  piece table, the first seconds' animation packs and the sheets they draw from, and resolves with the `Replay`. Every path
  in the manifest is resolved against `baseUrl`, the art store's root, not against the manifest's URL;
  `replay.assetUrl(path)` resolves one the same way (the map's `layout`, the `background`). In the background it
  fetches the other packs, then every sheet in `sheetOrder`, four at a time. `replay.loaded` settles when everything
  is in. It reads manifests and art groups of format 3 and 4 (`FORMATS`), and rejects any other format, or a format 4
  file of the wrong shape, saying what's wrong. Abort `signal` when the page leaves the match or opens another: every
  download stops, `loadReplay` rejects if it hasn't resolved yet, and `replay.loaded` rejects with the signal's reason
  (an `AbortError`), so catch it or ignore that error.
- A bone shows the piece its row in an art group gives the sprite frame. Past the end of the row, a format 4 group
  shows the row's last piece, as the game shows a symbol's last frame, and a format 3 group shows none.
- `drawPlayer` and `drawObject` draw a player or an object whole or not at all: while a piece of the frame hasn't
  loaded they draw nothing, return `false`, and move the sheets that frame needs to the front of what's left to load.
  A page that pauses while they return `false` never shows a half-loaded legend.
- `isReady(replay, player, animationIndex)` says whether an animation can be drawn at every frame the match shows.
- `poseAt(timeline, slot, step, frameCount?)` is a player's animation frame, position, facing, weapon and tint at a
  step; `objectsAt(timeline, step, frameCount?)` lists the objects drawn then. Draw the `behind` ones first.
- `cameraTrack(timeline, bounds, options)` plays the game's camera over the match; `cameraAt(track, step)` is its
  rectangle at a step, eased in time between the frames the game drew, and `viewToCanvas(rect, width, height)` the
  matrix that shows it on a canvas. A track is for one frame rate and one playback speed: pass `fps` and `speed` as
  [The camera](#the-camera) says.
  `backgroundToCanvas(image, width, height)` places the level's background, which the camera never moves.
- `mapArtUrl(replay, mapFile, file)` is where a platform art piece's image is, by the `file` of a `layout.art` piece
  and the map file's `artAssets`; it's null for a file the export left out, so skip that piece.
- `bubblesAt(view, offscreenPlayersAt(timeline, step))` gives the off-screen bubbles for a view.

## Files

| File | What it does |
| --- | --- |
| `src/format.ts` | the types of the export's files, and the formats this reads |
| `src/read.ts` | checks a fetched manifest's and art group's format, and format 4's shape |
| `src/load.ts` | loads a match's manifest, art groups, packs and sheets |
| `src/map-art.ts` | finds a map's platform art in the art store |
| `src/draw.ts` | draws players and objects on a canvas |
| `src/placement.ts` | finds the piece each draw of a frame shows, and where (no DOM) |
| `src/pack.ts` | reads animation packs |
| `src/timeline.ts` | a player's pose and the objects drawn at a step of a replay line |
| `src/steps.ts` | reads a line's lists of changes by step |
| `src/tint.ts` | the colour the game draws a player in at a step |
| `src/camera.ts` | the game's camera over a replay line |
| `src/offscreen.ts` | the bubbles the game draws for players out of view |

The files import each other with their `.ts` extension and use only TypeScript that erases to JavaScript, so the
export's own checks can run them unbundled, under Node and in a plain browser. A workspace that imports the package
needs `"allowImportingTsExtensions": true` (with `"noEmit": true`) in its tsconfig, or tsc rejects those imports.

## Tints

Besides the animation, the game draws each player in a colour transform: each channel times a multiplier plus an
offset (alpha kept). It works the tint out once a frame, and the first match wins:

| When | Tint (multiplier / offset) | From the line |
| --- | --- | --- |
| after a respawn (until they start a move or 2.5 s pass) | `ffffff / 666666` while the clock is in the first 100 ms of every 300, none between: a blink | `afterRespawn`, `stepZeroTime` |
| the player can't be hit (a dodge, among others) | `ffffff / 333333`, lighter | `invulnerable` |
| for 175 ms after a hit, its step included (11 steps) | `555555 /` the damage's colour: `aaaaaa` at 0, `aaaa00` at 50, `aa6600`, `aa0000`, `7f0000`, `5d0000`, `310000` from 300, in a straight line between, each channel cut to a whole number | `lastHit`, `damage` |
| both air jumps used | `bbbbbb / 111111`, darker | `airJumpsUsed` |

`tintAt(timeline, slot, step)` plays the rule; `poseAt` puts it in the pose as `tint`. A line without `stepZeroTime`
has no tints. Modes the lines don't cover (volleyball, horde, the tutorial, the training room) are left out.

`drawPlayer` draws a tinted pose into a layer the size of its box, darkens it with one fill (or adds the offset in the
same fill where it can, as for the hit flash), and draws it onto the canvas; an offset alone is added with `lighter`
over the frame. That's the game's sum wherever the canvas under the player is opaque.

## The camera

The game's camera updates once per drawn frame and eases by a fixed fraction per update, tuned for one step a frame.
`src/camera.ts` plays its rules one step at a time over what the line carries, in the level's CameraBounds:

- each player is framed from 80 units above their feet, with 480 units of room to either side and 270 above and below.
  In a match of two players, thrown weapons and crates are framed too (320 by 180 of room), the view growing towards a
  crate by no more than 9.6 units a step;
- a window, the bounds fitted to the screen's shape (16:9), pans towards the target's middle by 0.025 of the way a
  step, and the target is kept inside it;
- each side of the view eases towards the target: inwards by 0.384/18 of the way a step, at least 2.5 units;
  outwards no faster than 10.4 units a step more than the step before (5.85 up and down);
- the view is at least 2100 by 1400 (or the bounds' size), grown about its middle, and fitted to the screen's shape;
- it stays still for the match's first 3 seconds, and once 6 seconds are past it holds for half a second after it
  last grew.

Against the camera recorded from the game over whole matches, the view's middle is off by a median 0.3 to 0.4 % of
its width, and its width by a median 0 to 0.2 %.

### Frame rate and speed

Those rates are per update, and the game updates once per drawn frame, after the steps the frame ran. A replay's
speed changes how many steps a frame runs: its clock moves by the frame's time times the speed. So the camera moves
differently at each speed. At 2x it eases once for every two steps; at 0.5x it eases at every step, but the half
second's hold, which is timed by the real clock, lasts half as many steps. A frame that runs no step leaves the camera
alone.

A track keeps each update's view at the time its frame is drawn: the frame's replay clock, less the one step a step
takes to show, so between the frame's last step and the next. Every frame is then moved back by how far past its last
step a frame is on average (about half a step at 60 fps), as the game shows a frame's view with the players at its last
step. `cameraAt` eases between those frames in time. Read
step by step instead, the view would stand still on screen wherever a frame runs two steps (one step in 25 at 60 fps,
every frame at 2x) and then jump two steps' worth. `track.steps` still holds the view the game shows at each step.

A caller that plays a match at more than one speed passes `cameraTrack` both of these, and keeps a track per speed:

| Option | What to pass | Left out |
| --- | --- | --- |
| `fps` | the frame rate the match is drawn at (a 60 Hz screen: 60) | a frame lasts one step's 16 ms |
| `speed` | how fast the playback clock runs: the speed picked, times any slow-down the page adds | 1 |

- A track plays the match from its first step at one speed. The game carries its camera on across a change of speed
  or a seek; a page that changes speed reads the other track from there on, and has to cover the jump itself.
- The game's own speeds are 0.25, 0.5, 1, 2 and 5; any speed above 0 works here.
- A speed of 0 or less throws a `RangeError`. At 0 the game is paused: no step runs, so its camera stays where it is,
  and a page shows the view it last had. Backwards (the game's -0.25 to -5) it steps the match back every frame and
  eases the camera on from wherever it was, towards where the players were, so its path depends on where the rewind
  began and a track from the match's start can't hold it.

## Off screen

When a player's feet are past an edge of the camera's view, by any amount, the game draws a bubble at the edge:

- only while the player is in play (the line's `live`), and for 146 ms after a KO, while it fades and slides out by
  630 units times how far it has faded;
- each side the player is past holds the bubble's middle 210 units inside it; along an edge it follows the player.
  It's centred on the middle of the body, 80 units above the feet;
- the player isn't drawn twice: their own sprite moves to the bubble (`bubble.player`), at the world's scale, with
  their weapon and tint. Objects stay where they are;
- the art is a circle of radius 165 units with an arrow that turns in eight steps of 45 degrees, to the side or
  corner the player is past. The export carries it as the objects' last animation (`manifest.offscreenBubble`), so
  `drawObject` draws it under `bubbleMatrix(bubble)`, after everything else;
- two bubbles at the same side overlap; the game doesn't move one aside.
