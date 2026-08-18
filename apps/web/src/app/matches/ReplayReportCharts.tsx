import type React from 'react'
import type { ReplayReportKnockout, ReplayReportPlayer } from './replay-report'

const playerBarClasses = ['bg-primary', 'bg-chart-3', 'bg-chart-5'] as const

function playerBarClass(index: number): (typeof playerBarClasses)[number] {
  return playerBarClasses[index % playerBarClasses.length] ?? 'bg-primary'
}

function boundedWidth(value: number, denominator: number): string {
  return `${Math.min(Math.max((value / denominator) * 100, 0), 100)}%`
}

function formatNumber(value: number | null): string {
  if (value === null) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatShare(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1_000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function timelineX(timestampMs: number, durationMs: number): number {
  const progress = durationMs > 0 ? timestampMs / durationMs : 0
  return 20 + Math.min(Math.max(progress, 0), 1) * 960
}

export function ComparisonBars({
  label,
  values,
  percentage = false,
}: {
  label: string
  values: readonly { id: string | number; name: string; value: number | null }[]
  percentage?: boolean
}): React.ReactNode {
  const denominator = Math.max(...values.map(({ value }) => value ?? 0), 1)
  const display = percentage ? formatShare : formatNumber

  return (
    <section className="space-y-3" aria-label={label}>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      {values.map(({ id, name, value }, index) => (
        <div key={id} role="img" aria-label={`${label}, ${name}: ${display(value)}`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 break-all font-semibold">{name}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums">{display(value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${playerBarClass(index)}`}
              style={{ width: boundedWidth(value ?? 0, percentage ? 1 : denominator) }}
            />
          </div>
        </div>
      ))}
    </section>
  )
}

export function MovementBars({ players }: { players: readonly ReplayReportPlayer[] }): React.ReactNode {
  const metrics = [
    ['Dodges', (player: ReplayReportPlayer) => player.movement.dodges, false],
    ['Dashes', (player: ReplayReportPlayer) => player.movement.dashes, false],
    ['Jumps', (player: ReplayReportPlayer) => player.movement.jumps, false],
    ['Dash jumps', (player: ReplayReportPlayer) => player.movement.dashJumps, false],
    ['Dodges per minute', (player: ReplayReportPlayer) => player.movement.dodgesPerMinute, false],
    ['Dashes per minute', (player: ReplayReportPlayer) => player.movement.dashesPerMinute, false],
    ['Jumps per minute', (player: ReplayReportPlayer) => player.movement.jumpsPerMinute, false],
    ['Dash jumps per minute', (player: ReplayReportPlayer) => player.movement.dashJumpsPerMinute, false],
    ['Air dodge share', (player: ReplayReportPlayer) => player.movement.airDodgeShare, true],
    ['Air jump share', (player: ReplayReportPlayer) => player.movement.airJumpShare, true],
    ['Dash jump share', (player: ReplayReportPlayer) => player.movement.dashJumpShare, true],
  ] as const

  return (
    <section className="grid gap-5 sm:grid-cols-2" aria-label="Movement comparison">
      {metrics.map(([label, valueForPlayer, percentage]) => (
        <ComparisonBars
          key={label}
          label={label}
          percentage={percentage}
          values={players.map((player) => ({ id: player.slot, name: player.name, value: valueForPlayer(player) }))}
        />
      ))}
    </section>
  )
}

export function PositioningBars({ players }: { players: readonly ReplayReportPlayer[] }): React.ReactNode {
  return (
    <div className="space-y-5">
      {players.map((player) => {
        const { airTimeShare: air, groundTimeShare: ground, wallTimeShare: wall } = player.movement
        const label = `Air ${formatShare(air)} · Ground ${formatShare(ground)} · Wall ${formatShare(wall)}`
        return (
          <section key={player.slot} aria-label={`${player.name} positioning`}>
            <div className="flex flex-col justify-between gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
              <span className="break-all font-semibold">{player.name}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className="bg-primary"
                style={{ width: boundedWidth(ground ?? 0, 1) }}
                title={`Ground ${formatShare(ground)}`}
              />
              <div
                className="bg-chart-3"
                style={{ width: boundedWidth(air ?? 0, 1) }}
                title={`Air ${formatShare(air)}`}
              />
              <div
                className="bg-chart-5"
                style={{ width: boundedWidth(wall ?? 0, 1) }}
                title={`Wall ${formatShare(wall)}`}
              />
            </div>
          </section>
        )
      })}
      <div className="flex flex-wrap gap-4 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary" />
          Ground
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-chart-3" />
          Air
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-chart-5" />
          Wall
        </span>
      </div>
    </div>
  )
}

export function KnockoutTimeline({
  durationMs,
  knockouts,
}: {
  durationMs: number
  knockouts: readonly ReplayReportKnockout[]
}): React.ReactNode {
  if (knockouts.length === 0) return <p className="text-sm text-muted-foreground">No knockouts were recorded.</p>

  return (
    <>
      <svg viewBox="0 0 1000 92" className="h-24 w-full" role="img" aria-label="Knockout sequence timeline">
        <line x1="20" x2="980" y1="44" y2="44" className="stroke-border" strokeWidth="4" />
        {knockouts.map((knockout, index) => (
          <circle
            key={`${knockout.timestampMs}-${knockout.victimName}-${index}`}
            cx={timelineX(knockout.timestampMs, durationMs)}
            cy="44"
            r="10"
            className="fill-primary stroke-background"
            strokeWidth="4"
          />
        ))}
      </svg>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {knockouts.map((knockout, index) => (
          <li
            key={`${knockout.timestampMs}-${knockout.victimName}-${index}`}
            className="flex items-center gap-3 rounded-md border border-border/70 bg-muted/20 p-3 text-sm"
          >
            <span className="shrink-0 font-mono text-xs font-bold text-primary">
              {formatDuration(knockout.timestampMs)}
            </span>
            <span className="break-words">
              <strong>{knockout.scorerName ?? 'Unknown scorer'}</strong> knocked out {knockout.victimName}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}
