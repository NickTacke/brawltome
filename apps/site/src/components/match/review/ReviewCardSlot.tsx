import type { Moment } from '@brawltome/contracts'
import type { StopCount } from '../stage/ReviewControls'
import type { LanePlayer } from './lane-players'
import { ReviewCard } from './ReviewCard'

type ReviewCardSlotProps = {
  // the stop the replay stands on; none while it plays on to the next one
  moment: Moment | null
  lanes: LanePlayer[]
  count: StopCount
}

/**
 * A review's card on a phone, where a stage this small has no room for it: under the lanes, the upright card. The
 * slot keeps a card's height while the replay plays between stops, so what follows on the page stays where it is.
 * px-6 is the page's gutter, as the stage and its controls run to the screen's edges.
 */
export function ReviewCardSlot({ moment, lanes, count }: ReviewCardSlotProps) {
  return (
    <div className="min-h-[8.5rem] px-6 pt-2">
      {moment ? (
        <div data-review-card className="rounded-lg bg-raised/40 p-3 ring-1 ring-line/50">
          <ReviewCard moment={moment} lanes={lanes} count={count} isWide={false} />
        </div>
      ) : null}
    </div>
  )
}
