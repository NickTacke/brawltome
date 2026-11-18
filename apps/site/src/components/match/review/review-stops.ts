import type { MatchInsights, Moment, ReviewScope } from '@brawltome/contracts'

// what a review of one player's match can step through. the insights list every stop; this only puts them in order
// under the names a review picks them by

export type ReviewChoice = { key: ReviewScope; label: string; stops: Moment[] }

const scopeLabels: [ReviewScope, string][] = [
  ['key', 'Key moments'],
  ['taken', 'Hits taken'],
  ['dealt', 'Punishes landed'],
  ['kos', 'KOs'],
]

/** The short review first: the KOs and heavy punishes on either side. Then everything taken, everything landed, the KOs. */
export function reviewChoicesOf(insights: MatchInsights, slot: number): ReviewChoice[] {
  const momentsByKey = new Map(insights.insights.moments.map((moment) => [moment.key, moment]))

  const stopsOf = (scope: ReviewScope) =>
    insights.reviewStops
      .filter((stop) => stop.slot === slot && stop.scope === scope)
      .flatMap((stop) => momentsByKey.get(stop.momentKey) ?? [])

  return scopeLabels.map(([key, label]) => ({ key, label, stops: stopsOf(key) }))
}
