import type { Moment } from '@brawltome/contracts'
import type { StopCount } from '../stage/ReviewControls'
import type { LanePlayer } from './lane-players'
import { MomentClassTag } from './MomentClassTag'
import { momentBeginning } from './moment-text'
import { HitString, MomentCost, WhoHitWhom } from './ReviewFacts'

// which stop of how many the card explains
function StopNumber({ count }: { count: StopCount }) {
  return (
    <span className="shrink-0 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-strong tabular-nums">
      {count.index + 1}
      <span className="font-normal text-soft">&nbsp;of {count.total}</span>
    </span>
  )
}

type ReviewCardProps = {
  moment: Moment
  lanes: LanePlayer[]
  count: StopCount
  // two lines across instead of four down, for a stop whose players leave the upright card no place
  isWide: boolean
}

/**
 * What a stop says, like a line of a game review: which stop it is, its class and cost, who hit whom, the hits in
 * order, and how it began.
 */
export function ReviewCard({ moment, lanes, count, isWide }: ReviewCardProps) {
  const heading = (
    <>
      <StopNumber count={count} />
      <MomentClassTag kind={moment.class} />
    </>
  )

  const cost = (
    <span className="ml-auto">
      <MomentCost moment={moment} />
    </span>
  )

  const beginning = momentBeginning(moment)

  if (isWide) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2.5">
          {heading}
          <WhoHitWhom moment={moment} lanes={lanes} />
          {cost}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <HitString moment={moment} />
          <span className="text-xs text-text">{beginning}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5">
        {heading}
        {cost}
      </div>
      <WhoHitWhom moment={moment} lanes={lanes} />
      <HitString moment={moment} />
      <p className="text-xs leading-snug text-text">{beginning}</p>
    </div>
  )
}
