import type { MatchDetailContract } from '@brawltome/contracts'
import {
  type CameraTrack,
  cameraOptions,
  cameraTrack,
  loadReplay,
  type Replay,
  type Timeline,
} from '@brawltome/replay-player'
import { useEffect, useMemo, useState } from 'react'
import { fetchPlaybackTimeline } from './playback-timeline'

// what drawing the match's legends needs: the art the replay worker exported for it, and the playback timeline the
// legends, the tokens and the game's camera are drawn from. the timeline loads whatever the art's state, as the
// tokens that stand in for the legends play from it too

type Art = MatchDetailContract['art']

export type LegendsState = 'loading' | 'ready' | 'unavailable'

export type Legends = {
  replay: Replay | null
  timeline: Timeline | null
  track: CameraTrack | null
  state: LegendsState
  // true while the art downloads; a match whose art is still being exported waits without it
  isDownloading: boolean
}

type Load<Value> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; value: Value }
  | { status: 'failed' }

// the page draws a frame per display refresh, which is 60 a second on most screens; the game's camera updates once per
// drawn frame, so it is played at that rate
const framesPerSecond = 60

// a queued or failed export keeps the last good manifest, so art shows whenever there is one; without one, only a
// match whose art is queued is still waiting for its legends. without a timeline nothing could play the art, so none
// is downloaded
function manifestOf(art: Art, playbackPath: string | null): { manifestUrl: string; baseUrl: string } | null {
  if (!playbackPath || !art.manifestUrl || !art.baseUrl) return null

  return { manifestUrl: art.manifestUrl, baseUrl: art.baseUrl }
}

/** Whether the legends are on the way, drawn, or not coming, from how far the art and the timeline have loaded. */
export function legendsStateOf(art: Art, replay: Load<Replay>, timeline: Load<Timeline>): LegendsState {
  if (replay.status === 'failed' || timeline.status === 'failed') return 'unavailable'

  if (replay.status === 'idle') return art.state === 'queued' ? 'loading' : 'unavailable'

  if (replay.status === 'loaded' && timeline.status === 'loaded') return 'ready'

  return 'loading'
}

/** The legends before anything has loaded, as the server renders them. */
export function initialLegends(art: Art, playbackPath: string | null): Legends {
  const replay: Load<Replay> = manifestOf(art, playbackPath) ? { status: 'loading' } : { status: 'idle' }
  const timeline: Load<Timeline> = playbackPath ? { status: 'loading' } : { status: 'failed' }
  const state = legendsStateOf(art, replay, timeline)

  return { replay: null, timeline: null, track: null, state, isDownloading: replay.status === 'loading' }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

// leaving the match aborts what it still loads, which isn't a failure
function reportUnlessAborted(what: string, error: unknown): void {
  if (!isAbort(error)) console.error(`${what}:`, error)
}

function useReplayArt(art: Art, playbackPath: string | null): Load<Replay> {
  const manifest = manifestOf(art, playbackPath)
  const manifestUrl = manifest?.manifestUrl ?? null
  const baseUrl = manifest?.baseUrl ?? null
  const [load, setLoad] = useState<Load<Replay>>(manifest ? { status: 'loading' } : { status: 'idle' })

  useEffect(() => {
    if (!manifestUrl || !baseUrl) return setLoad({ status: 'idle' })

    const controller = new AbortController()

    setLoad({ status: 'loading' })

    loadReplay(manifestUrl, { baseUrl, signal: controller.signal })
      .then((replay) => {
        if (controller.signal.aborted) return

        replay.loaded.catch((error) => reportUnlessAborted(`load the rest of the art at ${manifestUrl}`, error))
        setLoad({ status: 'loaded', value: replay })
      })
      .catch((error) => {
        if (controller.signal.aborted) return

        reportUnlessAborted(`load the art at ${manifestUrl}`, error)
        setLoad({ status: 'failed' })
      })

    return () => controller.abort()
  }, [manifestUrl, baseUrl])

  return load
}

function usePlaybackTimeline(playbackPath: string | null): Load<Timeline> {
  const [load, setLoad] = useState<Load<Timeline>>(playbackPath ? { status: 'loading' } : { status: 'failed' })

  useEffect(() => {
    if (!playbackPath) return setLoad({ status: 'failed' })

    const controller = new AbortController()

    setLoad({ status: 'loading' })

    fetchPlaybackTimeline(playbackPath, controller.signal)
      .then((timeline) => {
        if (controller.signal.aborted) return

        setLoad({ status: 'loaded', value: timeline })
      })
      .catch((error) => {
        if (controller.signal.aborted) return

        reportUnlessAborted(`load the playback timeline at ${playbackPath}`, error)
        setLoad({ status: 'failed' })
      })

    return () => controller.abort()
  }, [playbackPath])

  return load
}

// the game's camera over the whole match, played once per match; an export without the level's bounds has none
function trackOf(replay: Replay | null, timeline: Timeline | null): CameraTrack | null {
  const bounds = replay?.manifest.cameraBounds

  if (!replay || !timeline || !bounds) return null

  return cameraTrack(timeline, bounds, { ...cameraOptions(replay.manifest), fps: framesPerSecond })
}

/** The match's legends and timeline, once the first seconds of the art can be drawn; the rest goes on loading after. */
export function useLegends(art: Art, playbackPath: string | null): Legends {
  const replayLoad = useReplayArt(art, playbackPath)
  const timelineLoad = usePlaybackTimeline(playbackPath)
  const replay = replayLoad.status === 'loaded' ? replayLoad.value : null
  const timeline = timelineLoad.status === 'loaded' ? timelineLoad.value : null
  const track = useMemo(() => trackOf(replay, timeline), [replay, timeline])
  const state = legendsStateOf(art, replayLoad, timelineLoad)

  return { replay, timeline, track, state, isDownloading: replayLoad.status === 'loading' }
}
