import { type RefObject, useLayoutEffect, useState } from 'react'
import type { Pose } from '../stage/pose'
import { useStageBox } from '../stage/use-stage-box'

// bottom-2 on the panel: its band of the stage runs from the stage's edge
const panelGapPx = 8
// the stage width the players' sizes below were taken at; on a narrower stage they shrink with it
const measuredStageWidthPx = 780
// what a player takes up above and below their feet: the body with its tag, and the ring of a review's stop
const bodyAbovePx = 72
const bodyBelowPx = 20

type Edge = 'top' | 'bottom'
type Size = { width: number; height: number }
type Placed = { key: string; edge: Edge }

export type PanelStudy = {
  // names the frame the replay is standing on: a review's stop, or a pause. null while it plays
  key: string | null
  // the players to keep clear of, where the camera shows them
  players: Pose[]
  // true when the top edge is taken by something else, as it is when the stage fills the screen
  isBottomOnly: boolean
}

// true when a band this high along an edge of the stage would lie on one of the players
function isOnPlayers(edge: Edge, poses: Pose[], stage: Size, bandPx: number): boolean {
  const scale = Math.min(1, stage.width / measuredStageWidthPx)

  return poses.some((pose) => {
    const feet = pose.y * stage.height
    const top = feet - bodyAbovePx * scale
    const bottom = feet + bodyBelowPx * scale

    return edge === 'top' ? top < bandPx : bottom > stage.height - bandPx
  })
}

type EdgeChoice = { study: PanelStudy; stage: Size; bandPx: number; heldEdge: Edge | null; isHeld: boolean }

/**
 * The edge for the lanes at a frame: the bottom, unless players stand there and not along the top. Under a resting
 * pointer the lanes keep their edge, and only move when they would lie on players and the other edge is free.
 */
export function edgeFor({ study, stage, bandPx, heldEdge, isHeld }: EdgeChoice): Edge {
  if (study.isBottomOnly) return 'bottom'

  const taken = {
    top: isOnPlayers('top', study.players, stage, bandPx),
    bottom: isOnPlayers('bottom', study.players, stage, bandPx),
  }

  if (!isHeld) return taken.bottom && !taken.top ? 'top' : 'bottom'

  const kept = heldEdge ?? 'bottom'
  const other = kept === 'top' ? 'bottom' : 'top'

  return taken[kept] && !taken[other] ? other : kept
}

/**
 * The edge the lanes lie along while the replay stands on a frame, decided once for that frame so they don't jump
 * about under a scrub. Where players stand along both edges, the lanes stay along the bottom and lie on them; they
 * never go away or shrink. While the pointer rests on the lanes they keep their edge where they can, also while the
 * replay plays on to the next stop.
 */
export function usePanelPlace(panelRef: RefObject<HTMLElement | null>, study: PanelStudy, isHeld: boolean) {
  const [placed, setPlaced] = useState<Placed | null>(null)
  const box = useStageBox(panelRef, `${study.key}`)
  const bandPx = box ? box.element.height + panelGapPx : 0

  // while it plays the panel is back along the bottom, unless the pointer rests on it: then it stays where it is
  useLayoutEffect(() => {
    if (study.key === null && !isHeld) setPlaced(null)
  }, [study.key, isHeld])

  // biome-ignore lint/correctness/useExhaustiveDependencies: decided once per frame, when it is first measured
  useLayoutEffect(() => {
    if (study.key === null || !box || placed?.key === study.key) return

    const edge = edgeFor({ study, stage: box.stage, bandPx, heldEdge: placed?.edge ?? null, isHeld })

    setPlaced({ key: study.key, edge })
  }, [study.key, box !== null])

  const edge: Edge = study.isBottomOnly ? 'bottom' : (placed?.edge ?? 'bottom')

  return { edge, bandPx }
}
