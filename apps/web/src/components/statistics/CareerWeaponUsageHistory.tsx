import type { CareerWeaponUsageHistoryOutputContract } from '@brawltome/contracts'

type Direction = 'increase' | 'decrease' | 'unchanged'

function basisPoints(value: number, direction: Direction): string {
  return `${value > 0 ? '+' : ''}${value} bp (${direction})`
}

function exactDifference(value: { numerator: string; denominator: string }, direction: Direction): string {
  const numerator = BigInt(value.numerator)
  const denominator = BigInt(value.denominator)
  const absolute = numerator < 0n ? -numerator : numerator
  const roundedHundredths = (absolute * 200n + denominator) / (denominator * 2n)
  const digits = String(roundedHundredths).padStart(3, '0')
  const sign = numerator > 0n ? '+' : numerator < 0n ? '-' : ''
  const decimal = `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`
  if ((absolute * 100n) % denominator === 0n) return `${decimal} (${direction})`
  return `${decimal} (${direction}; exact ${sign}${absolute}/${denominator})`
}

function percentage(value: { numerator: string; denominator: string } | null): string {
  if (!value) return 'coverage unavailable'
  const numerator = BigInt(value.numerator)
  const denominator = BigInt(value.denominator)
  const roundedBasisPoints = (numerator * 20_000n + denominator) / (denominator * 2n)
  return `${(Number(roundedBasisPoints) / 100).toFixed(2)}% coverage`
}

export function CareerWeaponUsageHistory({
  history,
  error,
}: {
  history?: CareerWeaponUsageHistoryOutputContract
  error?: string
}) {
  if (error) {
    return (
      <section aria-labelledby="career-history-heading" className="space-y-3">
        <h2 id="career-history-heading" className="text-2xl font-semibold">
          Snapshot history
        </h2>
        <output role="alert" className="block rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <strong>Career history unavailable.</strong> {error}
        </output>
      </section>
    )
  }
  if (!history) {
    return (
      <output aria-live="polite" className="block rounded-xl border border-border p-4">
        Loading snapshot history…
      </output>
    )
  }
  if (history.status === 'unavailable') {
    return (
      <section aria-labelledby="career-history-heading" className="space-y-3">
        <h2 id="career-history-heading" className="text-2xl font-semibold">
          Snapshot history
        </h2>
        <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
          No validated Career history is available yet.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="career-history-heading" className="space-y-4">
      <div>
        <h2 id="career-history-heading" className="text-2xl font-semibold">
          Snapshot history
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {history.entries.length} validated snapshots. Each uses lifetime weapon observations for players selected by
          the current 1v1 bracket filter. Comparisons stop at the first incompatible adjacent snapshot.
        </p>
      </div>
      {history.entries.map(({ snapshot, comparisonToPrevious }) => (
        <article key={snapshot.snapshotId} className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
          <h3 className="font-semibold">
            Published{' '}
            <time dateTime={snapshot.publishedAt}>{new Date(snapshot.publishedAt).toLocaleDateString('en-US')}</time>
          </h3>
          <p className="text-sm text-muted-foreground">
            {snapshot.successfulObservations.toLocaleString('en-US')} of{' '}
            {snapshot.selectedPlayers.toLocaleString('en-US')} selected players observed (
            {percentage(snapshot.coverage)}); {snapshot.totalHeldSeconds} total weapon-held seconds. Counts and coverage
            are snapshot values, not changes.
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
              <table className="w-full min-w-[700px] text-sm">
                <caption className="sr-only">
                  Eligible Career weapon changes from the adjacent previous snapshot
                </caption>
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2" scope="col">
                      Weapon
                    </th>
                    <th className="p-2" scope="col">
                      Prevalence
                    </th>
                    <th className="p-2" scope="col">
                      Held-time share
                    </th>
                    <th className="p-2" scope="col">
                      Damage / minute
                    </th>
                    <th className="p-2" scope="col">
                      KOs / hour
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonToPrevious.deltas.map((delta) => (
                    <tr key={delta.weapon} className="border-t border-border">
                      <th className="p-2 text-left" scope="row">
                        {delta.weapon}
                      </th>
                      <td className="p-2">
                        {basisPoints(delta.prevalence.changeBasisPoints, delta.prevalence.direction)}
                      </td>
                      <td className="p-2">
                        {basisPoints(delta.heldTimeShare.changeBasisPoints, delta.heldTimeShare.direction)}
                      </td>
                      <td className="p-2">
                        {exactDifference(delta.medianDamagePerMinute.change, delta.medianDamagePerMinute.direction)}
                      </td>
                      <td className="p-2">
                        {exactDifference(delta.medianKosPerHour.change, delta.medianKosPerHour.direction)}
                      </td>
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
