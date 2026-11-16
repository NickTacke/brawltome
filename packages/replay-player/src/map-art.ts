// Finds a map's platform art in the art store: the map file (maps/<fingerprint>.json, MapFile) names a sheet for each
// art file its layout draws. No DOM.
import type { MapFile } from './format.ts'
import type { Replay } from './load.ts'

/**
 * Where a layout art piece's image is (its `file`, such as `BP8.MainPlat.png`), or null when the map file has none for
 * it: the page skips that piece. A path outside the art store throws, as the manifest's own paths do.
 */
export function mapArtUrl(
  replay: Pick<Replay, 'assetUrl'>,
  map: Pick<MapFile, 'artAssets'>,
  file: string,
): string | null {
  const artAssets = map.artAssets ?? {}

  // own keys only: a file named like an object's built-in property ("constructor") isn't listed
  if (!Object.hasOwn(artAssets, file)) return null

  return replay.assetUrl(artAssets[file] as string)
}
