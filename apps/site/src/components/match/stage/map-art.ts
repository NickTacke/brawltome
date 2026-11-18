import type { StageArt } from '@brawltome/contracts'
import { type MapFile, mapArtUrl, type Replay } from '@brawltome/replay-player'

// a platform's art, where the stage box has it, with the image the art store keeps for it
export type PlacedArt = StageArt & { url: string }

/**
 * The platforms whose image the art store has, in the layout's order. A piece the export left out, or one whose image
 * would lie outside the store, is skipped: its collision lines still show where it stands.
 */
export function placedArtOf(art: StageArt[], urlOf: (file: string) => string | null): PlacedArt[] {
  return art.flatMap((piece) => {
    try {
      const url = urlOf(piece.file)

      return url ? [{ ...piece, url }] : []
    } catch {
      return []
    }
  })
}

/** The map file the replay was exported with, from the art store; it names the image of each platform. */
export async function fetchMapFile(replay: Replay, signal: AbortSignal): Promise<MapFile> {
  const url = replay.assetUrl(replay.manifest.map.layout)
  const response = await fetch(url, { signal })

  if (!response.ok) throw new Error(`load map file ${url}: HTTP ${response.status}`)

  return (await response.json()) as MapFile
}

/** Each platform of the stage with its image, once the map file is in. */
export function placedArtFor(art: StageArt[], replay: Replay, mapFile: MapFile): PlacedArt[] {
  return placedArtOf(art, (file) => mapArtUrl(replay, mapFile, file))
}
