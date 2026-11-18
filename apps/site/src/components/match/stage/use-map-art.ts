import type { StageArt } from '@brawltome/contracts'
import type { MapFile, Replay } from '@brawltome/replay-player'
import { useEffect, useMemo, useState } from 'react'
import { fetchMapFile, type PlacedArt, placedArtFor } from './map-art'

// one list, so the still stage isn't handed a new one every frame
const noArt: PlacedArt[] = []

/**
 * The stage's platform art, once the replay's art and its map file have loaded. Without them, or for a map file the
 * export wrote before it carried platform art, there is none and the stage keeps its collision lines alone.
 */
export function useMapArt(replay: Replay | null, art: StageArt[]): PlacedArt[] {
  const [mapFile, setMapFile] = useState<MapFile | null>(null)

  useEffect(() => {
    setMapFile(null)

    if (!replay) return

    const controller = new AbortController()

    fetchMapFile(replay, controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setMapFile(loaded)
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error('load the map file for its platform art:', error)
      })

    return () => controller.abort()
  }, [replay])

  return useMemo(() => (replay && mapFile ? placedArtFor(art, replay, mapFile) : noArt), [replay, mapFile, art])
}
