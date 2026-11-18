import type { Replay } from '@brawltome/replay-player'

/** The level's background, from the art the replay worker exported; none until it loads, or for a map without one. */
export function backgroundUrlOf(replay: Replay | null): string | null {
  const background = replay?.manifest.background

  if (!replay || !background) return null

  try {
    return replay.assetUrl(background.asset)
  } catch {
    return null
  }
}
