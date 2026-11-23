import { IconTooltip, iconTooltipParent } from '../../IconTooltip'
import { statLabel } from '../../player/player-styles'
import { LeadGraph, type LeadGraphProps } from './LeadGraph'
import { formatLead, leadAt, standingOf } from './lead-samples'

const sideName = 'text-[0.6875rem] leading-none font-bold tracking-wide text-soft uppercase'

// the short form of leadRule, which the graph's own title gives in full
const leadMeaning = 'Stocks ahead, counting damage as part of a stock'

// beside the stage the panel is at the page's right edge, under it at the left, and its tooltips open inwards
type Side = { isUpright: boolean }

// the lead at the playhead, as a figure with its name over it and what it means under it
function LeadNow({ lead, finalLead, isUpright }: { lead: number; finalLead: number } & Side) {
  return (
    <div className={iconTooltipParent}>
      <div className={statLabel}>Lead</div>
      <div className="mt-0.5 text-2xl leading-7 font-bold text-strong tabular-nums">{formatLead(lead)}</div>
      <div className="text-xs text-soft">{standingOf(lead)}</div>
      {/* the graph shows how it ended; a screen reader is told */}
      <span className="sr-only">
        <span>Final lead</span> <span>{formatLead(finalLead)}</span>
      </span>
      <span className="sr-only">{leadMeaning}</span>
      <IconTooltip label={leadMeaning} align={isUpright ? 'end' : 'start'} />
    </div>
  )
}

/** Which way along the graph is ahead, named at its two ends. */
function SideNames({ isUpright }: Side) {
  const meaning = isUpright ? 'Right of the line, the picked side is ahead' : 'Above the line, the picked side is ahead'

  if (isUpright) {
    return (
      <div className={`mt-3 ${iconTooltipParent}`}>
        <div className={`flex justify-between pb-1.5 ${sideName}`}>
          <span>Behind</span>
          <span>Ahead</span>
        </div>
        <IconTooltip label={meaning} align="end" />
      </div>
    )
  }

  return (
    <div className={iconTooltipParent}>
      <div className={`flex h-full flex-col justify-between py-1 text-right ${sideName}`}>
        <span>Ahead</span>
        <span>Behind</span>
      </div>
      <IconTooltip label={meaning} align="start" />
    </div>
  )
}

/**
 * The lead beside the replay: how far ahead the picked player is right now, and under that the whole match as a
 * graph, with both of its sides named. Under a stage too narrow to stand beside, the same lies flat.
 */
export function LeadPanel(graph: LeadGraphProps) {
  const lead = leadAt(graph.samples, graph.timeMs)
  const finalLead = graph.samples.at(-1) ?? 0

  if (!graph.isUpright) {
    return (
      <div className="mt-3 flex items-stretch gap-4">
        <div className="w-24 shrink-0">
          <LeadNow lead={lead} finalLead={finalLead} isUpright={false} />
        </div>
        <SideNames isUpright={false} />
        <div className="h-16 min-w-0 flex-1">
          <LeadGraph {...graph} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-24 flex-col">
      <LeadNow lead={lead} finalLead={finalLead} isUpright />
      <SideNames isUpright />
      <div className="min-h-0 flex-1">
        <LeadGraph {...graph} />
      </div>
    </div>
  )
}
