import type { LegendMetaHistoryOutput } from '@brawltome/contracts'

function signed(value: number, digits = 0): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
}

function basisPoints(value: number, direction: 'increase' | 'decrease' | 'unchanged'): string {
  return `${signed(value)} bp (${direction})`
}

function ratingChange(value: number, direction: 'increase' | 'decrease' | 'unchanged'): string {
  return `${signed(value, 1)} (${direction})`
}

export function LegendMetaHistory({
  history,
  error,
  loading = false,
}: {
  history?: LegendMetaHistoryOutput
  error?: string
  loading?: boolean
}) {
  if (error) {
    return (
      <section aria-labelledby="legend-history-heading" className="mx-auto w-full max-w-7xl space-y-3">
        <h2 id="legend-history-heading" className="text-2xl font-semibold">
          Snapshot history
        </h2>
        <output role="alert" className="block rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <strong>Legend history unavailable.</strong> {error}
        </output>
      </section>
    )
  }
  if (loading || !history) {
    return (
      <output aria-live="polite" className="mx-auto block w-full max-w-7xl rounded-xl border border-border p-4">
        Loading snapshot history…
      </output>
    )
  }
  if (history.status === 'unavailable') {
    return (
      <section aria-labelledby="legend-history-heading" className="mx-auto w-full max-w-7xl space-y-3">
        <h2 id="legend-history-heading" className="text-2xl font-semibold">
          Snapshot history
        </h2>
        <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          No validated Legend history is available yet.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="legend-history-heading" className="mx-auto w-full max-w-7xl space-y-4">
      <div>
        <h2 id="legend-history-heading" className="text-2xl font-semibold">
          Snapshot history
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {history.entries.length} validated snapshots. Comparisons stop at the first incompatible adjacent snapshot.
        </p>
      </div>
      {history.entries.map(({ snapshot, comparisonToPrevious }) => (
        <article key={snapshot.snapshotId} className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
          <h3 className="font-semibold">
            Published{' '}
            <time dateTime={snapshot.publishedAt}>{new Date(snapshot.publishedAt).toLocaleDateString('en-US')}</time>
          </h3>
          <p className="text-sm text-muted-foreground">
            {snapshot.observedPlayers.toLocaleString('en-US')} of {snapshot.selectedPlayers.toLocaleString('en-US')}{' '}
            selected players observed (
            {snapshot.coverage.basisPoints === null
              ? 'coverage unavailable'
              : `${(snapshot.coverage.basisPoints / 100).toFixed(2)}% coverage`}
            ); {snapshot.observedLegendGames.toLocaleString('en-US')} observed Legend games. Counts and coverage are
            snapshot values, not changes.
          </p>
          {comparisonToPrevious?.status === 'incompatible' && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <strong>Series break.</strong>
              <ul className="mt-1 list-disc pl-5">
                {comparisonToPrevious.reasons.map((reason) => (
                  <li key={reason.code}>{reason.explanation}</li>
                ))}
              </ul>
            </div>
          )}
          {comparisonToPrevious?.status === 'available' && comparisonToPrevious.deltas.length === 0 && (
            <p className="text-sm text-muted-foreground">No rows were eligible in both adjacent snapshots.</p>
          )}
          {comparisonToPrevious?.status === 'available' && comparisonToPrevious.deltas.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Eligible Legend changes from the adjacent previous snapshot</caption>
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2" scope="col">
                      Legend
                    </th>
                    <th className="p-2" scope="col">
                      Pick share
                    </th>
                    <th className="p-2" scope="col">
                      Adoption
                    </th>
                    <th className="p-2" scope="col">
                      Win rate
                    </th>
                    <th className="p-2" scope="col">
                      Median rating
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonToPrevious.deltas.map((delta) => (
                    <tr key={delta.legend.legendId} className="border-t border-border">
                      <th className="p-2 text-left" scope="row">
                        {delta.legend.name}
                      </th>
                      <td className="p-2">
                        {basisPoints(delta.pickShare.changeBasisPoints, delta.pickShare.direction)}
                      </td>
                      <td className="p-2">{basisPoints(delta.adoption.changeBasisPoints, delta.adoption.direction)}</td>
                      <td className="p-2">{basisPoints(delta.winRate.changeBasisPoints, delta.winRate.direction)}</td>
                      <td className="p-2">{ratingChange(delta.medianRating.change, delta.medianRating.direction)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      ))}
    </section>
  )
}
