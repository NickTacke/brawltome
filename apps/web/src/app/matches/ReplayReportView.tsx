'use client'

import { Avatar, AvatarFallback, Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import { Crown } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { ComparisonBars, KnockoutTimeline, MovementBars, PositioningBars, formatDuration } from './ReplayReportCharts'
import type { ReplayReport, ReplayReportPlayer } from './replay-report'

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

function formatShare(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function reportTimestamp(value: string | null): string {
  return value ? `${value.slice(0, 10)} · ${value.slice(11, 16)} UTC` : 'Not available'
}

function playerValues(players: readonly ReplayReportPlayer[], value: (player: ReplayReportPlayer) => number | null) {
  return players.map((player) => ({ id: player.slot, name: player.name, value: value(player) }))
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
  const name = <span className="block break-all text-lg font-black">{player.name}</span>
  return (
    <Card className={player.won ? 'border-primary/50' : undefined}>
      <CardContent className="p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-14 w-14 rounded-lg border border-border bg-muted">
            <AppearanceImage key={`${player.slot}-${player.appearance.skinId}`} player={player} />
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {player.profileHref ? (
                <Link href={player.profileHref} className="min-w-0 hover:text-primary">
                  {name}
                </Link>
              ) : (
                name
              )}
              {player.won && <Crown className="h-4 w-4 shrink-0 text-amber-500" aria-label="Winner" />}
            </div>
            <p className="break-words text-xs text-muted-foreground">
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
              <p className="font-mono text-lg font-black tabular-nums">{value ?? '—'}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function CapabilityCard({ title, available }: { title: string; available: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-semibold text-muted-foreground">
          {available ? 'Qualified event timeline available' : 'Requires qualified event timeline'}
        </p>
      </CardContent>
    </Card>
  )
}

function EquipmentAndPowers({ players }: { players: readonly ReplayReportPlayer[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {players.map((player) => {
        if (player.equipment === null || player.powers === null) {
          return (
            <section key={player.slot} className="rounded-lg border border-border/70 bg-background/40 p-4">
              <h4 className="break-all font-black">{player.name}</h4>
              <p className="mt-3 text-sm text-muted-foreground">
                Equipment and power counters unavailable in preview data.
              </p>
            </section>
          )
        }

        return (
          <section key={player.slot} className="rounded-lg border border-border/70 bg-background/40 p-4">
            <h4 className="break-all font-black">{player.name}</h4>
            <div className="mt-4 space-y-5">
              {player.equipment.length > 0 && (
                <ComparisonBars
                  label="Equipment held share"
                  percentage
                  values={player.equipment.map((equipment) => ({
                    id: `${player.slot}-equipment-${equipment.key}`,
                    name: equipment.key,
                    value: equipment.heldTimeShare,
                  }))}
                />
              )}
              {player.powers.length > 0 && (
                <ComparisonBars
                  label="Power uses"
                  values={player.powers.map((power) => ({
                    id: `${player.slot}-${power.equipmentKey}-${power.key}`,
                    name: power.key,
                    value: power.uses,
                  }))}
                />
              )}
              {player.equipment.length === 0 && player.powers.length === 0 && (
                <p className="text-sm text-muted-foreground">No equipment or power counters were recorded.</p>
              )}
              {(player.equipment.length > 0 || player.powers.length > 0) && (
                <details className="rounded-md border border-border/70">
                  <summary className="cursor-pointer p-3 text-sm font-bold">
                    Equipment and power details for {player.name}
                  </summary>
                  <div className="space-y-3 border-t border-border/70 p-3 text-xs text-muted-foreground">
                    {player.equipment.map((equipment) => (
                      <p key={equipment.key}>
                        <strong className="text-foreground">{equipment.key}</strong>:{' '}
                        {formatShare(equipment.heldTimeShare)} held
                        {' · '}
                        {formatMetric(equipment.enemyDamage)} damage
                      </p>
                    ))}
                    {player.powers.map((power) => (
                      <div key={`${power.equipmentKey}-${power.key}`}>
                        <p>
                          <strong className="font-mono text-foreground">{power.key}</strong>: {power.uses} uses ·{' '}
                          {power.enemyHits} hits · {formatMetric(power.enemyDamage)} damage · {power.enemyKos} KOs
                        </p>
                        <p className="mt-1">
                          Damage/hit {formatMetric(power.enemyDamagePerHit)} · Damage/use{' '}
                          {formatMetric(power.enemyDamagePerUse)} · Hits/use {formatMetric(power.enemyHitsPerUse)} ·
                          KOs/use {formatMetric(power.enemyKosPerUse)}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
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
            <dd className="break-all font-mono text-sm">{report.fileName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Analyzed</dt>
            <dd className="font-mono text-sm">{reportTimestamp(report.analyzedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Game build</dt>
            <dd className="break-all font-mono text-sm">{report.gameBuild ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Duration</dt>
            <dd className="font-mono text-sm">{report.durationMs} ms</dd>
          </div>
        </dl>

        {report.players.map((player) => (
          <section key={player.slot}>
            <h4 className="break-all font-black">{player.name} exact counters</h4>
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
                <dd className="break-all font-mono text-sm">{report.provenance.collector}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Processor version</dt>
                <dd className="break-all font-mono text-sm">{report.provenance.processorVersion}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Qualification profile</dt>
                <dd className="break-all font-mono text-sm">{report.provenance.qualificationProfile}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Replay digest</dt>
                <dd className="break-all font-mono text-sm">{report.provenance.replayDigest}</dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </details>
  )
}

export function ReplayReportView({ report }: { report: ReplayReport }) {
  const timestamp = report.playedAt ?? report.analyzedAt
  return (
    <article className="space-y-6" aria-label="Selected replay analysis">
      <header className="flex min-w-0 flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{report.mode}</Badge>
            <Badge variant="outline">{report.source === 'real' ? 'Analyzed replay' : 'Preview data'}</Badge>
            {report.fileName && <Badge variant="outline">{report.fileName}</Badge>}
            {report.gameBuild && <Badge variant="outline">Build {report.gameBuild}</Badge>}
          </div>
          <h2 className="mt-3 break-all text-3xl font-black tracking-tight sm:text-5xl">{report.title}</h2>
          <p className="mt-2 break-words text-sm text-muted-foreground">
            {report.mapName} · {formatDuration(report.durationMs)} · {reportTimestamp(timestamp)}
          </p>
        </div>
        <div className="min-w-0 max-w-full md:text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">Winner</p>
          <p className="mt-1 break-all text-2xl font-black">{report.winnerLabel}</p>
        </div>
      </header>

      <section className="grid gap-3 lg:grid-cols-2" aria-label="Teams and final scores">
        {report.teams.map((team) => (
          <section
            key={team.id}
            className="rounded-lg border border-border bg-card p-3"
            aria-label={`Team ${team.id} final score ${team.score ?? 'unavailable'}${team.won ? ', winner' : ''}`}
          >
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/60 pb-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Team {team.id}</p>
              <p className="font-mono text-2xl font-black tabular-nums">{team.score ?? '—'}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {team.playerSlots.map((slot) => {
                const player = report.players.find((candidate) => candidate.slot === slot)
                return player ? <PlayerIdentity key={player.slot} player={player} /> : null
              })}
            </div>
          </section>
        ))}
      </section>

      <section className="space-y-3" aria-labelledby="event-overview-heading">
        <h3 id="event-overview-heading" className="text-2xl font-black">
          Event overview
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <CapabilityCard title="Damage progression" available={report.capabilities.eventTimeline} />
          <CapabilityCard title="Best engagement" available={report.capabilities.eventTimeline} />
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Extended combat</CardTitle>
          <p className="text-sm text-muted-foreground">Direct replay counters and denominator-aware rates.</p>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <ComparisonBars
              label="Damage comparison"
              values={playerValues(report.players, (player) => player.combat.damageDealt)}
            />
            <ComparisonBars
              label="Damage taken comparison"
              values={playerValues(report.players, (player) => player.combat.damageTaken)}
            />
            <ComparisonBars
              label="Team damage dealt"
              values={playerValues(report.players, (player) => player.combat.teamDamageDealt)}
            />
            <ComparisonBars
              label="Team damage taken"
              values={playerValues(report.players, (player) => player.combat.teamDamageTaken)}
            />
          </div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            <ComparisonBars
              label="Damage per minute"
              values={playerValues(report.players, (player) => player.combat.damageDealtPerMinute)}
            />
            <ComparisonBars
              label="Damage per KO"
              values={playerValues(report.players, (player) => player.combat.damageDealtPerKo)}
            />
            <ComparisonBars
              label="Damage taken per death"
              values={playerValues(report.players, (player) => player.combat.damageTakenPerDeath)}
            />
            <ComparisonBars
              label="KO/death ratio"
              values={playerValues(report.players, (player) => player.combat.koDeathRatio)}
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
        <CardContent className="space-y-8">
          <MovementBars players={report.players} />
          <PositioningBars players={report.players} />
        </CardContent>
      </Card>

      <CapabilityCard title="Dodge directions" available={report.capabilities.dodgeDirections} />
      <CapabilityCard title="Engagements" available={report.capabilities.engagements} />

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
