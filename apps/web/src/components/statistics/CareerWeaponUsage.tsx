import {
  type CareerWeaponExactRatioContract,
  type CareerWeaponUsageHistoryOutputContract,
  type CareerWeaponUsageOutputContract,
  type CareerWeaponUsageRowContract,
  careerWeaponUsageBracketScopes,
  careerWeaponUsageRegionScopes,
} from '@brawltome/contracts'
import { Card } from '@brawltome/ui'
import type { ReactNode } from 'react'
import { CareerWeaponUsageHistory } from './CareerWeaponUsageHistory'

const regionLabels: Record<(typeof careerWeaponUsageRegionScopes)[number], string> = {
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

const bracketLabels: Record<(typeof careerWeaponUsageBracketScopes)[number], string> = {
  all: 'All launch brackets',
  Platinum: 'Platinum (1680-1999)',
  'Diamond+': 'Diamond+ (2000+)',
}

function fixedRatio(value: CareerWeaponExactRatioContract, decimalPlaces: number): string {
  const numerator = BigInt(value.numerator)
  const denominator = BigInt(value.denominator)
  const scale = 10n ** BigInt(decimalPlaces)
  const rounded = (numerator * scale * 2n + denominator) / (denominator * 2n)
  if (decimalPlaces === 0) return String(rounded)
  const digits = String(rounded).padStart(decimalPlaces + 1, '0')
  return `${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`
}

function percentage(value: CareerWeaponExactRatioContract | null): string {
  if (!value) return 'Unavailable'
  return `${fixedRatio({ numerator: String(BigInt(value.numerator) * 100n), denominator: value.denominator }, 1)}%`
}

function rate(value: CareerWeaponExactRatioContract | null): string {
  return value ? fixedRatio(value, 2) : 'Unavailable'
}

function comparisonSummary(row: CareerWeaponUsageRowContract): string {
  if (row.comparison.eligible) return 'Eligible for comparison'
  const reasons = row.comparison.reasons.map((reason) =>
    reason === 'contributors-below-30' ? 'fewer than 30 contributors' : 'fewer than 30 aggregate observed held hours',
  )
  return `Insufficient data: ${reasons.join(' and ')}`
}

function Filters({ filters }: { filters: CareerWeaponUsageOutputContract['filters'] }) {
  return (
    <form
      action="/stats/career-weapon-usage"
      method="get"
      className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <div className="space-y-2">
        <label htmlFor="career-region" className="block text-sm font-semibold text-foreground">
          Region
        </label>
        <select
          id="career-region"
          name="region"
          defaultValue={filters.region}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          {careerWeaponUsageRegionScopes.map((region) => (
            <option key={region} value={region}>
              {regionLabels[region]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label htmlFor="career-bracket" className="block text-sm font-semibold text-foreground">
          Current 1v1 bracket
        </label>
        <select
          id="career-bracket"
          name="bracket"
          defaultValue={filters.bracket}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          {careerWeaponUsageBracketScopes.map((bracket) => (
            <option key={bracket} value={bracket}>
              {bracketLabels[bracket]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
        Apply filters
      </button>
    </form>
  )
}

function StaleNotice({ reasons }: { reasons: ('newer_publication_rejected' | 'weekly_publication_overdue')[] }) {
  const details = [
    reasons.includes('newer_publication_rejected') ? 'A newer weekly snapshot did not pass validation.' : null,
    reasons.includes('weekly_publication_overdue') ? 'The next weekly publication is overdue.' : null,
  ].filter(Boolean)
  return (
    <output className="block rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-amber-100">
      <strong>Update delayed.</strong> {details.join(' ')} Showing the last valid career observations.
    </output>
  )
}

function SnapshotTable({ view }: { view: Exclude<CareerWeaponUsageOutputContract, { status: 'unavailable' }> }) {
  const coverage = view.coverage ? percentage(view.coverage) : 'Unavailable'
  return (
    <>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          {view.successfulObservations.toLocaleString('en-US')} of {view.selectedPlayers.toLocaleString('en-US')}{' '}
          selected players observed ({coverage} coverage). Rows are alphabetical, not a weapon ranking.
        </p>
        <p>
          Observation window: <time dateTime={view.observationWindow.startsAt}>{view.observationWindow.startsAt}</time>{' '}
          through <time dateTime={view.observationWindow.endsAt}>{view.observationWindow.endsAt}</time>. Published{' '}
          <time dateTime={view.publishedAt}>{view.publishedAt}</time>.
        </p>
        <p>
          Career metric methodology: {view.methodologyVersion}. Cohort methodology: {view.cohortMethodologyVersion}.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[960px] text-sm" aria-describedby="career-methodology">
          <caption className="sr-only">
            Career weapon-held observations for {regionLabels[view.filters.region]},{' '}
            {bracketLabels[view.filters.bracket]}
          </caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              <th scope="col" className="p-3">
                Weapon
              </th>
              <th scope="col" className="p-3">
                Prevalence
              </th>
              <th scope="col" className="p-3">
                Held-time share
              </th>
              <th scope="col" className="p-3">
                Median damage / held minute
              </th>
              <th scope="col" className="p-3">
                Median KOs / held hour
              </th>
              <th scope="col" className="p-3">
                Contributors
              </th>
              <th scope="col" className="p-3">
                Coverage
              </th>
              <th scope="col" className="p-3">
                Comparison evidence
              </th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.weapon} className="border-t border-border align-top">
                <th scope="row" className="p-3 font-semibold">
                  {row.weapon}
                </th>
                <td className="p-3">
                  <span className="block">{percentage(row.prevalence)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.observedPlayers.toLocaleString('en-US')} of{' '}
                    {view.successfulObservations.toLocaleString('en-US')} observed players
                  </span>
                </td>
                <td className="p-3">{percentage(row.heldTimeShare)}</td>
                <td className="p-3">{rate(row.medianDamagePerMinute)}</td>
                <td className="p-3">{rate(row.medianKosPerHour)}</td>
                <td className="p-3">{row.contributorCount.toLocaleString('en-US')}</td>
                <td className="p-3">{coverage}</td>
                <td className="p-3">{comparisonSummary(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function CareerWeaponUsageShell({
  filters,
  children,
}: {
  filters: CareerWeaponUsageOutputContract['filters']
  children: ReactNode
}) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Global Statistics</p>
        <h1 className="text-3xl font-bold">Career Weapon Usage</h1>
        <p className="max-w-4xl text-muted-foreground">
          Career observations from players currently in the selected bracket. These lifetime usage rates do not describe
          current-season performance or weapon strength.
        </p>
      </header>
      <Card className="space-y-5 p-5">
        <h2 className="text-lg font-semibold">Observation scope</h2>
        <Filters filters={filters} />
      </Card>
      {children}
    </main>
  )
}

export function CareerWeaponUsageLoadError({
  filters,
}: {
  filters: CareerWeaponUsageOutputContract['filters']
}) {
  return (
    <CareerWeaponUsageShell filters={filters}>
      <Card role="alert" className="border-destructive/50 bg-destructive/10 p-6">
        <h2 className="text-xl font-semibold">Unable to load Career Weapon Usage</h2>
        <p className="mt-2 text-muted-foreground">
          The statistics service could not be reached. Existing observations are not being shown as zero. Try again
          shortly.
        </p>
      </Card>
    </CareerWeaponUsageShell>
  )
}

export function CareerWeaponUsage({
  view,
  history,
  historyError,
}: {
  view: CareerWeaponUsageOutputContract
  history?: CareerWeaponUsageHistoryOutputContract
  historyError?: string
}) {
  return (
    <CareerWeaponUsageShell filters={view.filters}>
      {view.status === 'unavailable' ? (
        <output className="block">
          <Card className="p-6">
            <h2 className="text-xl font-semibold">Career Weapon Usage is not yet available</h2>
            <p className="mt-2 text-muted-foreground">
              No validated lifetime cohort snapshot has been published for this scope. Missing observations are not
              shown as measured zeros.
            </p>
          </Card>
        </output>
      ) : (
        <section aria-labelledby="career-results-heading" className="space-y-4">
          <h2 id="career-results-heading" className="text-2xl font-semibold">
            Observed weapon use
          </h2>
          {view.status === 'stale' && <StaleNotice reasons={view.staleReasons} />}
          <SnapshotTable view={view} />
        </section>
      )}

      <CareerWeaponUsageHistory history={history} error={historyError} />

      <section id="career-methodology" aria-labelledby="career-methodology-heading" className="space-y-3">
        <h2 id="career-methodology-heading" className="text-2xl font-semibold">
          Methodology and uncertainty
        </h2>
        <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          <p>
            Prevalence is players with positive weapon-held time divided by successful lifetime observations. Held-time
            share uses all observed weapon-held seconds.
          </p>
          <p>
            Damage and KO values are the median of per-player rates. A player contributes only with at least 30 held
            minutes per player and weapon.
          </p>
          <p>
            Comparison eligibility requires 30 qualifying contributors and 30 aggregate observed held hours.
            Insufficient rows remain visible but are not ranked.
          </p>
          <p>
            Coverage is successful lifetime observations divided by selected cohort players. The bracket describes
            players at cohort selection, not their historical rank when weapon use occurred.
          </p>
        </div>
      </section>
    </CareerWeaponUsageShell>
  )
}
