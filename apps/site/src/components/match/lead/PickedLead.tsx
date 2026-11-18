import type { MatchInsights } from '@brawltome/contracts'
import { useMemo } from 'react'
import { slotColour } from '../match-styles'
import { LeadPanel } from './LeadPanel'
import { leadSamplesFor } from './lead-samples'

type PickedLeadProps = {
  insights: MatchInsights
  selectedSlot: number
  timeMs: number
  onSeek: (timeMs: number) => void
  isUpright: boolean
}

/** The lead panel for the picked player: their side's lead in their colour, with every KO along it. */
export function PickedLead({ insights, selectedSlot, timeMs, onSeek, isUpright }: PickedLeadProps) {
  const samples = useMemo(() => leadSamplesFor(insights, selectedSlot), [insights, selectedSlot])
  const { knockouts } = insights.insights

  // each KO in the colour of who went out
  const marks = useMemo(
    () => knockouts.map((knockout) => ({ timeMs: knockout.timeMs, colour: slotColour(knockout.victim) })),
    [knockouts],
  )

  if (samples.length === 0) return null

  return (
    <LeadPanel
      samples={samples}
      colour={slotColour(selectedSlot)}
      marks={marks}
      timeMs={timeMs}
      durationMs={insights.summary.durationMs}
      onSeek={onSeek}
      isUpright={isUpright}
    />
  )
}
