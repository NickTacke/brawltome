import type { LevelLayout, Stage } from '@brawltome/contracts'
import type { MatchFacts } from '../facts'
import { type Position, positionAt } from '../positions'
import { isLive, type MatchRecord } from '../record'
import { readPlayback } from './playback'
import { tracedBox } from './stage-box'
import { cameraBox, layoutArt, layoutSegments, rectOf } from './stage-layout'
import { readStageMarks } from './stage-marks'

// the match drawn on its stage: where the platforms are, where each player stood, hit, got hit and went out. the
// geometry comes from the map's level layout; without one the box is traced from where players stood and no
// platforms are drawn, so nothing on the stage is guessed

const sampleEverySteps = 4

function liveSamples(record: MatchRecord, slot: number): Position[] {
  const samples: Position[] = []

  for (let step = record.startStep; step < record.endStep; step += sampleEverySteps) {
    const position = isLive(record, slot, step) ? positionAt(record, slot, step) : null

    if (position) samples.push(position)
  }

  return samples
}

const wholeBox = { x: 0, y: 0, width: 1, height: 1 }

export function readStage(facts: MatchFacts, layout: LevelLayout | null): Stage {
  const { record } = facts
  const everywhere = record.players.flatMap((player) => liveSamples(record, player.slot))
  const box = layout ? cameraBox(layout) : tracedBox(everywhere)

  return {
    background: layout?.background ?? null,
    camera: layout ? rectOf(box, layout.camera) : wholeBox,
    aspect: box.width / box.height,
    segments: layout ? layoutSegments(box, layout) : [],
    art: layout ? layoutArt(box, layout) : [],
    isTraced: layout === null,
    marks: readStageMarks(facts, box),
    playback: readPlayback(record, box),
  }
}
