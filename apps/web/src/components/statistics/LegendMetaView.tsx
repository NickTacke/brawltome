import {
  type LegendMetaInput,
  type LegendMetaOutput,
  legendMetaBrackets,
  legendMetaRegions,
} from '@brawltome/contracts'
import { legendAvatarUrl } from '@brawltome/game-data'

const regionLabels: Record<(typeof legendMetaRegions)[number], string> = {
  all: 'All regions',
  'US-E': 'US East',
  'US-W': 'US West',
  EU: 'Europe',
  SEA: 'Southeast Asia',
  AUS: 'Australia',
  BRZ: 'Brazil',
  JPN: 'Japan',
  ME: 'Middle East',
  SA: 'Southern Africa',
}

const bracketLabels: Record<(typeof legendMetaBrackets)[number], string> = {
  all: 'All current 1v1 brackets',
  Platinum: 'Platinum (1680–1999)',
  'Diamond+': 'Diamond+ (2000+)',
}

function percentage(basisPoints: number | null): string {
  return basisPoints === null ? 'Unavailable' : `${(basisPoints / 100).toFixed(2)}%`
}

function ratioTitle(ratio: { numerator: number; denominator: number }): string {
  return `${ratio.numerator.toLocaleString('en-US')} / ${ratio.denominator.toLocaleString('en-US')}`
}

function uncertainty(interval: { lowerBasisPoints: number; upperBasisPoints: number } | null): string {
  if (!interval) return 'Unavailable'
  return `${percentage(interval.lowerBasisPoints)}–${percentage(interval.upperBasisPoints)}`
}

function formattedRating(rating: number | null): string {
  return rating === null ? 'Unavailable' : rating.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

function MetricBar({ basisPoints }: { basisPoints: number | null }) {
  if (basisPoints === null) return <span className="text-muted-foreground">Unavailable</span>
  return (
    <div className="ml-auto w-24 space-y-1 text-right">
      <span className="font-mono font-semibold text-foreground">{percentage(basisPoints)}</span>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${basisPoints / 100}%` }} />
      </div>
    </div>
  )
}

function FilterControls({
  region,
  bracket,
  onFilterChange,
}: LegendMetaInput & {
  onFilterChange(next: LegendMetaInput): void
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label
          htmlFor="legend-meta-region"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Region
        </label>
        <select
          id="legend-meta-region"
          value={region}
          onChange={(event) =>
            onFilterChange({ region: event.currentTarget.value as LegendMetaInput['region'], bracket })
          }
          className="min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {legendMetaRegions.map((value) => (
            <option key={value} value={value}>
              {regionLabels[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label
          htmlFor="legend-meta-bracket"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Current 1v1 bracket
        </label>
        <select
          id="legend-meta-bracket"
          value={bracket}
          onChange={(event) =>
            onFilterChange({ region, bracket: event.currentTarget.value as LegendMetaInput['bracket'] })
          }
          className="min-h-10 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {legendMetaBrackets.map((value) => (
            <option key={value} value={value}>
              {bracketLabels[value]}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function LegendMetaView({
  data,
  region,
  bracket,
  onFilterChange,
}: {
  data: LegendMetaOutput
  region: LegendMetaInput['region']
  bracket: LegendMetaInput['bracket']
  onFilterChange(next: LegendMetaInput): void
}) {
  return (
    <section aria-labelledby="legend-meta-heading" className="mx-auto w-full max-w-7xl space-y-6">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Statistics</p>
        <div className="space-y-2">
          <h1 id="legend-meta-heading" className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Current Season Legend Meta
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
            Choose a region and current 1v1 bracket to compare outcomes observed from a deterministic BrawlTome cohort.
            These measurements describe the observed sample, not causal legend strength.
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-border bg-card/60 p-4 sm:p-5">
        <FilterControls region={region} bracket={bracket} onFilterChange={onFilterChange} />
      </div>

      {data.status === 'unavailable' ? (
        <div className="rounded-xl border border-border bg-card/60 p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">Statistics unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">No validated Legend Meta publication is available yet.</p>
        </div>
      ) : (
        <>
          {data.status === 'stale' && (
            <output className="block rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              <strong>
                {data.staleReason === 'latest_build_failed' ? 'Latest build failed.' : 'Publication delayed.'}
              </strong>{' '}
              Showing the last validated snapshot from{' '}
              <time dateTime={data.publishedAt}>{new Date(data.publishedAt).toLocaleString('en-US')}</time>.
            </output>
          )}

          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card/60 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Coverage</dt>
              <dd className="mt-1 text-2xl font-bold text-foreground">{percentage(data.coverage.basisPoints)}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">
                {data.observedPlayers.toLocaleString('en-US')} of {data.selectedPlayers.toLocaleString('en-US')}{' '}
                selected players observed
              </dd>
            </div>
            <div className="rounded-xl border border-border bg-card/60 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Observed legend games
              </dt>
              <dd className="mt-1 text-2xl font-bold text-foreground">
                {data.observedLegendGames.toLocaleString('en-US')}
              </dd>
              <dd className="mt-1 text-xs text-muted-foreground">Current-season ranked 1v1 values</dd>
            </div>
            <div className="rounded-xl border border-border bg-card/60 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observed window</dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">
                <time dateTime={data.observationWindow.startsAt}>
                  {new Date(data.observationWindow.startsAt).toLocaleDateString('en-US')}
                </time>{' '}
                to{' '}
                <time dateTime={data.observationWindow.endsAt}>
                  {new Date(data.observationWindow.endsAt).toLocaleDateString('en-US')}
                </time>
              </dd>
              <dd className="mt-1 text-xs text-muted-foreground">Season identity unavailable from the source</dd>
            </div>
          </dl>

          <div className="overflow-x-auto rounded-xl border border-border bg-card/60">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <caption className="sr-only">
                Current Season Legend Meta for {regionLabels[data.filter.region]}, {bracketLabels[data.filter.bracket]}
              </caption>
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-center">
                    Rank
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Legend
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Pick share
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Adoption
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Observed win rate
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    95% interval
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Median rating
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Players / games
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.legend.legendId} className="border-t border-border align-middle">
                    <td className="px-4 py-4 text-center font-semibold text-foreground">
                      {row.rank ?? <span className="text-xs font-normal text-muted-foreground">Not ranked</span>}
                    </td>
                    <th scope="row" className="px-4 py-4 text-left">
                      <span className="flex items-center gap-3">
                        <img
                          src={legendAvatarUrl(row.legend.slug)}
                          alt=""
                          className="h-12 w-12 rounded-lg bg-muted object-cover object-top"
                          loading="lazy"
                        />
                        <span>
                          <span className="font-semibold text-foreground">{row.legend.name}</span>
                          {row.eligibility.status === 'insufficient-sample' && (
                            <span className="mt-1 block text-xs font-normal text-amber-300">Insufficient sample</span>
                          )}
                        </span>
                      </span>
                    </th>
                    <td className="px-4 py-4 text-right" title={ratioTitle(row.pickShare)}>
                      <MetricBar basisPoints={row.pickShare.basisPoints} />
                    </td>
                    <td className="px-4 py-4 text-right" title={ratioTitle(row.adoption)}>
                      <MetricBar basisPoints={row.adoption.basisPoints} />
                    </td>
                    <td className="px-4 py-4 text-right" title={ratioTitle(row.winRate)}>
                      <MetricBar basisPoints={row.winRate.basisPoints} />
                    </td>
                    <td className="px-4 py-4 text-right text-muted-foreground">{uncertainty(row.uncertainty95)}</td>
                    <td className="px-4 py-4 text-right">{formattedRating(row.medianRating)}</td>
                    <td className="px-4 py-4 text-right">
                      {row.playerCount.toLocaleString('en-US')} / {row.gameCount.toLocaleString('en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="rounded-xl border border-border bg-card/60 p-4 sm:p-5">
            <summary className="cursor-pointer font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Methodology
            </summary>
            <div className="mt-4 space-y-4 text-sm leading-6 text-muted-foreground">
              <p>{data.methodology.seasonalScope}</p>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-foreground">Pick share</dt>
                  <dd>{data.methodology.formulas.pickShare}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">Adoption</dt>
                  <dd>{data.methodology.formulas.adoption}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">Observed win rate</dt>
                  <dd>{data.methodology.formulas.winRate}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">Median rating</dt>
                  <dd>{data.methodology.formulas.medianRating}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">Coverage</dt>
                  <dd>{data.methodology.formulas.coverage}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">Uncertainty</dt>
                  <dd>{data.methodology.formulas.uncertainty}</dd>
                </div>
              </dl>
              <p>
                Comparative eligibility requires at least {data.methodology.eligibility.minimumPlayers} players and{' '}
                {data.methodology.eligibility.minimumGames} games. Ineligible legends remain visible but are not ranked.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {data.methodology.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </div>
          </details>
        </>
      )}
    </section>
  )
}
