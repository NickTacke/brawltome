import type { MomentClass } from '@brawltome/contracts'
import { classLabels, classRules } from './moment-class'

/** A class by its name, in plain type; hovering gives the rule that put the exchange in it. */
export function MomentClassTag({ kind }: { kind: MomentClass }) {
  return (
    <span title={classRules[kind]} className="shrink-0 text-sm font-bold text-strong">
      {classLabels[kind]}
    </span>
  )
}
