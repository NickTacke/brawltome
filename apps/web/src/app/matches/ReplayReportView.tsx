'use client'

import { Avatar, AvatarFallback, Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { Crown } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { ComparisonBars, KnockoutTimeline, MovementBars, PositioningBars, formatDuration } from './ReplayReportCharts'
import type { ReplayReport, ReplayReportPlayer } from './replay-report'

const playerBarClasses = ['bg-primary', 'bg-chart-3', 'bg-chart-5'] as const

function formatMetric(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toFixed(1)}${suffix}`
}

function formatShare(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function analyzedTimestamp(value: string | null): string {
  return value ? `${value.slice(0, 10)} · ${value.slice(11, 16)} UTC` : 'Not available'
}

function AppearanceImage({ player }: { player: ReplayReportPlayer }) {
  const primaryImageUrl = player.appearance.imageUrl ?? player.appearance.fallbackImageUrl
  const fallbackImageUrl = player.appearance.imageUrl ? player.appearance.fallbackImageUrl : null
  const [imageUrl, setImageUrl] = useState(primaryImageUrl)

  if (!imageUrl) {
    return (
      <AvatarFallback className="rounded-lg text-sm font-black text-muted-foreground">
        {player.name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    )
  }

  return (
    <img
      src={imageUrl}
      alt={player.appearance.name}
      className="aspect-square h-full w-full rounded-lg object-cover object-top"
      onError={() => setImageUrl(imageUrl === fallbackImageUrl ? null : fallbackImageUrl)}
    />
  )
}

function PlayerIdentity({ player }: { player: ReplayReportPlayer }) {
  const name = <span className="block truncate text-lg font-black">{player.name}</span>
  return (
    <Card className={player.won ? 'border-primary/50' : undefined}>
      <CardContent className="p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-14 w-14 rounded-lg border border-border bg-muted">
            <AppearanceImage key={`${player.slot}-${player.appearance.skinId}`} player={player} />
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {player.profileHref ? (
                <Link href={player.profileHref} className="min-w-0 hover:text-primary">
                  {name}
                </Link>
              ) : (
                name
              )}
              {player.won && <Crown className="h-4 w-4 shrink-0 text-amber-500" aria-label="Winner" />}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {player.appearance.name} · Team {player.teamId}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
          {[
            ['Score', player.score],
            ['KOs', player.combat.kos],
            ['Deaths', player.combat.deaths],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="font-mono text-lg font-black tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function UnavailableCard({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-semibold text-muted-foreground">Requires qualified event timeline</p>
      </CardContent>
    </Card>
  )
}

function NullableComparison({
  label,
  players,
  value,
}: {
  label: string
  players: readonly ReplayReportPlayer[]
  value: (player: ReplayReportPlayer) => number | null
}) {
  const values = players.map(value)
  const denominator = Math.max(...values.map((item) => item ?? 0), 1)
  return (
    <section className="space-y-3" aria-label={label}>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      {players.map((player, index) => {
        const item = value(player)
        return (
          <div key={player.slot} role="img" aria-label={`${label}, ${player.name}: ${formatMetric(item)}`}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-semibold">{player.name}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums">{formatMetric(item)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${playerBarClasses[index % playerBarClasses.length] ?? 'bg-primary'}`}
                style={{ width: `${Math.min(Math.max(((item ?? 0) / denominator) * 100, 0), 100)}%` }}
              />
            </div>
          </div>
        )
      })}
    </section>
  )
}

function EquipmentAndPowers({ players }: { players: readonly ReplayReportPlayer[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {players.map((player) => {
        const maxPowerUses = Math.max(...player.powers.map(({ uses }) => uses), 1)
        return (
          <section key={player.slot} className="rounded-lg border border-border/70 bg-background/40 p-4">
            <h4 className="font-black">{player.name}</h4>
            <div className="mt-4 space-y-4">
              {player.equipment.map((equipment) => (
                <div key={equipment.key}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{equipment.key}</span>
                    <span className="font-mono text-xs tabular-nums">
                      {formatShare(equipment.heldTimeShare)} held · {formatMetric(equipment.enemyDamage)} damage
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(Math.max((equipment.heldTimeShare ?? 0) * 100, 0), 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {player.powers.map((power) => (
                <div key={`${power.equipmentKey}-${power.key}`} className="border-t border-border/60 pt-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-mono font-bold">{power.key}</span>
                    <span className="font-mono text-xs font-bold tabular-nums">{power.uses} uses</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-chart-3"
                      style={{ width: `${(power.uses / maxPowerUses) * 100}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {power.enemyHits} hits · {formatMetric(power.enemyDamage)} damage · {power.enemyKos} KOs
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Damage/hit {formatMetric(power.enemyDamagePerHit)} · Damage/use{' '}
                    {formatMetric(power.enemyDamagePerUse)} · Hits/use {formatMetric(power.enemyHitsPerUse)} · KOs/use{' '}
                    {formatMetric(power.enemyKosPerUse)}
                  </p>
                </div>
              ))}
              {player.equipment.length === 0 && player.powers.length === 0 && (
                <p className="text-sm text-muted-foreground">No equipment counters were recorded.</p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Counter({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm font-bold tabular-nums">{value ?? '—'}</dd>
    </div>
  )
}

function ReplayDetails({ report }: { report: ReplayReport }) {
  return (
    <details className="rounded-lg border bg-card text-card-foreground shadow-xs">
      <summary className="cursor-pointer p-6 text-xl font-semibold">Replay details</summary>
      <div className="space-y-6 border-t border-border/70 p-6">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">File</dt>
            <dd className="font-mono text-sm">{report.fileName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Analyzed</dt>
            <dd className="font-mono text-sm">{analyzedTimestamp(report.analyzedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Game build</dt>
            <dd className="font-mono text-sm">{report.gameBuild ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Duration</dt>
            <dd className="font-mono text-sm">{report.durationMs} ms</dd>
          </div>
        </dl>

        {report.players.map((player) => (
          <section key={player.slot}>
            <h4 className="font-black">{player.name} exact counters</h4>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <Counter label="Score" value={player.score} />
              <Counter label="KOs" value={player.combat.kos} />
              <Counter label="Deaths" value={player.combat.deaths} />
              <Counter label="Suicides" value={player.combat.suicides} />
              <Counter label="Clashes" value={player.combat.clashes} />
              <Counter label="Damage dealt" value={player.combat.damageDealt} />
              <Counter label="Damage taken" value={player.combat.damageTaken} />
              <Counter label="Team damage dealt" value={player.combat.teamDamageDealt} />
              <Counter label="Team damage taken" value={player.combat.teamDamageTaken} />
              <Counter label="Dodges" value={player.movement.dodges} />
              <Counter label="Dashes" value={player.movement.dashes} />
              <Counter label="Jumps" value={player.movement.jumps} />
              <Counter label="Dash jumps" value={player.movement.dashJumps} />
            </dl>
          </section>
        ))}

        {report.limitations.length > 0 && (
          <section>
            <h4 className="font-black">Limitations</h4>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {report.limitations.map((limitation, index) => (
                <li key={`${limitation.code}-${index}`}>
                  <span className="font-mono">{limitation.code}</span>: {limitation.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.source === 'real' && report.provenance && (
          <section>
            <h4 className="font-black">Provenance</h4>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Collector</dt>
                <dd className="font-mono text-sm break-all">{report.provenance.collector}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Processor version</dt>
                <dd className="font-mono text-sm break-all">{report.provenance.processorVersion}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Qualification profile</dt>
                <dd className="font-mono text-sm break-all">{report.provenance.qualificationProfile}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Replay digest</dt>
                <dd className="font-mono text-sm break-all">{report.provenance.replayDigest}</dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </details>
  )
}

export function ReplayReportView({ report }: { report: ReplayReport }) {
  return (
    <article className="space-y-6" aria-label="Selected replay analysis">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{report.mode}</Badge>
            <Badge variant="outline">{report.source === 'real' ? 'Analyzed replay' : 'Preview data'}</Badge>
          </div>
          <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">{report.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {report.mapName} · {formatDuration(report.durationMs)} · {analyzedTimestamp(report.analyzedAt)}
          </p>
        </div>
        <div className="shrink-0 md:text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">Winner</p>
          <p className="mt-1 text-2xl font-black">{report.winnerLabel}</p>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Players">
        {report.players.map((player) => (
          <PlayerIdentity key={player.slot} player={player} />
        ))}
      </section>

      <UnavailableCard title="Event overview" />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Extended combat</CardTitle>
          <p className="text-sm text-muted-foreground">Direct replay counters and denominator-aware rates.</p>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="grid gap-6 lg:grid-cols-2">
            <ComparisonBars
              label="Damage comparison"
              values={report.players.map((player) => ({ name: player.name, value: player.combat.damageDealt }))}
            />
            <ComparisonBars
              label="Damage taken comparison"
              values={report.players.map((player) => ({ name: player.name, value: player.combat.damageTaken }))}
            />
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <NullableComparison
              label="Damage per minute"
              players={report.players}
              value={(player) => player.combat.damageDealtPerMinute}
            />
            <NullableComparison
              label="Damage per KO"
              players={report.players}
              value={(player) => player.combat.damageDealtPerKo}
            />
            <NullableComparison
              label="Damage taken per death"
              players={report.players}
              value={(player) => player.combat.damageTakenPerDeath}
            />
          </div>
          <EquipmentAndPowers players={report.players} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Movement &amp; positioning</CardTitle>
          <p className="text-sm text-muted-foreground">Direct action counters and measured positioning time.</p>
        </CardHeader>
        <CardContent className="grid gap-8 xl:grid-cols-2">
          <MovementBars players={report.players} />
          <PositioningBars players={report.players} />
        </CardContent>
      </Card>

      <UnavailableCard title="Dodge directions" />
      <UnavailableCard title="Engagements" />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Knockout sequence</CardTitle>
          <p className="text-sm text-muted-foreground">Chronological knockout events recorded by the replay.</p>
        </CardHeader>
        <CardContent>
          <KnockoutTimeline durationMs={report.durationMs} knockouts={report.knockouts} />
        </CardContent>
      </Card>

      <ReplayDetails report={report} />
    </article>
  )
}
