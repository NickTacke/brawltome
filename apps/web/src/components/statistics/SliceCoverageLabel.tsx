import type { LegendMetaOutput } from '@brawltome/contracts'
import { sliceCoverageNote } from './utils'

type LegendMetaSliceCoverage = Exclude<LegendMetaOutput, { status: 'unavailable' }>['sliceCoverage']

export function SliceCoverageLabel({ coverage }: { coverage: LegendMetaSliceCoverage }) {
  const note = sliceCoverageNote(coverage)

  if (!note) return null

  return <p className="text-sm text-muted-foreground">{note}</p>
}
