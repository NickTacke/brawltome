'use client'

import { MATCH_SUMMARY_EXTENSION_URI, type ReplayJobDetailContract } from '@brawltome/contracts'
import { getLegendById, getLevelById, legendSlug } from '@brawltome/game-data'
import { Avatar, AvatarFallback, AvatarImage, Badge, Card, CardContent, CardHeader, CardTitle } from '@brawltome/ui'
import { Activity, Clock3, Crown, Gauge, MapPinned, Shield, Swords, Trophy } from 'lucide-react'
import Link from 'next/link'

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1_000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function timelineX(timestampMs: number, durationMs: number): number {
  return 20 + Math.min(timestampMs / durationMs, 1) * 960
}

function formatMetric(value: number | null | undefined, suffix = ''): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}${suffix}`
}

function formatShare(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
}

function replayTimestamp(value: string): string {
  return `${value.slice(0, 10)} · ${value.slice(11, 16)} UTC`
}

function StatTile({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/60 p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 truncate text-lg font-black text-foreground">{value}</p>
    </div>
  )
}

export function ReplayResultView({ job }: { job: ReplayJobDetailContract }) {
  if (!job.result) return null
  const { core, extensions } = job.result
  const replay = core.replay
  const metricsBySlot = new Map(core.native.players.map((player) => [player.slot, player]))
  const summary = extensions[MATCH_SUMMARY_EXTENSION_URI]
  const summaryBySlot = new Map(summary?.data.players.map((player) => [player.slot, player]) ?? [])
  const playerBySlot = new Map(replay.players.map((player) => [player.slot, player]))
  const map = getLevelById(replay.mapId)
  const winningTeam = replay.outcome.winningTeamId
  const winners = winningTeam === null ? [] : replay.players.filter(({ teamId }) => teamId === winningTeam)
  const winnerLabel =
    winningTeam === null ? 'Draw' : winners.map(({ name }) => name).join(' & ') || `Team ${winningTeam}`
  const maxDamage = Math.max(
    ...core.native.players.flatMap(({ damageDealt, damageTaken }) => [damageDealt, damageTaken]),
    1,
  )
  const equipment = summary?.data.equipment
    .filter(({ heldTimeShare }) => heldTimeShare !== null)
    .toSorted((left, right) => (right.heldTimeShare ?? 0) - (left.heldTimeShare ?? 0))

  return (
    <article className="space-y-6" aria-label="Selected replay analysis">
      <Card className="overflow-hidden border-border bg-linear-to-br from-card via-card to-primary/5 shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-border/70 p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="gap-1.5 bg-success text-success-foreground">
                    <Trophy className="h-3 w-3" aria-hidden="true" />
                    Match complete
                  </Badge>
                  <Badge variant="outline" className="font-mono text-muted-foreground">
                    Playlist {replay.playlistId}
                  </Badge>
                </div>
                <p className="mt-4 max-w-xl truncate text-sm font-semibold text-muted-foreground">
                  {job.fileName ?? 'Brawlhalla replay'}
                </p>
                <h2 className="mt-1 text-3xl font-black tracking-tight text-foreground sm:text-4xl">
                  {map?.displayName ?? `Map ${replay.mapId}`}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">Analyzed {replayTimestamp(job.updatedAt)}</p>
              </div>
              <div className="min-w-48 rounded-lg border border-primary/20 bg-primary/10 px-5 py-4 text-right">
                <p className="text-xs font-bold uppercase tracking-wide text-primary">Winner</p>
                <p className="mt-1 text-xl font-black text-foreground">{winnerLabel}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7 xl:grid-cols-4" aria-label="Match summary">
            <StatTile icon={Clock3} label="Duration" value={formatDuration(replay.durationMs)} />
            <StatTile icon={MapPinned} label="Map" value={map?.displayName ?? `Map ${replay.mapId}`} />
            <StatTile
              icon={Shield}
              label="Rules"
              value={`${replay.matchSettings.lives} stocks · ${replay.matchSettings.teamMode ? 'Teams' : 'Free-for-all'}`}
            />
            <StatTile icon={Gauge} label="Session" value={replay.online ? 'Online' : 'Local'} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Swords className="h-5 w-5 text-primary" aria-hidden="true" />
                Scoreboard
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Core combat output for every replay slot.</p>
            </div>
            <span className="text-xs font-mono text-muted-foreground">Format {replay.format}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl text-left text-sm">
              <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3" scope="col">
                    Player
                  </th>
                  <th className="px-3 py-3 text-right" scope="col">
                    Score
                  </th>
                  <th className="px-3 py-3 text-right" scope="col">
                    KOs
                  </th>
                  <th className="px-3 py-3 text-right" scope="col">
                    Deaths
                  </th>
                  <th className="px-3 py-3 text-right" scope="col">
                    Dealt
                  </th>
                  <th className="px-3 py-3 text-right" scope="col">
                    Taken
                  </th>
                  <th className="px-5 py-3 text-right" scope="col">
                    Damage / min
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {replay.players.map((player) => {
                  const native = metricsBySlot.get(player.slot)
                  const playerSummary = summaryBySlot.get(player.slot)
                  const legend = getLegendById(player.loadout.legendId)
                  const avatarSlug = legend ? legendSlug(legend.heroId, legend.displayName) : null
                  const won = player.teamId === winningTeam
                  const playerName = <span>{player.name}</span>
                  return (
                    <tr key={player.slot} className={won ? 'bg-success/5' : undefined}>
                      <th className="px-5 py-4" scope="row">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10 rounded-md border border-border bg-muted">
                            {avatarSlug && (
                              <AvatarImage
                                src={`/images/legends/avatars/${avatarSlug}.png`}
                                alt={legend?.displayName ?? ''}
                                className="rounded-md object-cover object-top"
                              />
                            )}
                            <AvatarFallback className="rounded-md text-xs font-black text-muted-foreground">
                              {player.slot + 1}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="flex items-center gap-2 font-bold text-foreground">
                              {player.playerId !== null && player.playerId > 0 ? (
                                <Link
                                  href={`/player/${player.playerId}`}
                                  className="transition-colors hover:text-primary"
                                >
                                  {playerName}
                                </Link>
                              ) : (
                                playerName
                              )}
                              {won && <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="Winner" />}
                            </div>
                            <p className="text-xs font-normal text-muted-foreground">
                              {legend?.displayName ?? `Legend ${player.loadout.legendId}`} · Team {player.teamId}
                            </p>
                          </div>
                        </div>
                      </th>
                      <td className="px-3 py-4 text-right font-bold tabular-nums">{player.score}</td>
                      <td className="px-3 py-4 text-right font-black text-success tabular-nums">{native?.kos ?? 0}</td>
                      <td className="px-3 py-4 text-right font-bold tabular-nums">{native?.deaths ?? 0}</td>
                      <td className="px-3 py-4 text-right tabular-nums">{formatMetric(native?.damageDealt)}</td>
                      <td className="px-3 py-4 text-right tabular-nums">{formatMetric(native?.damageTaken)}</td>
                      <td className="px-5 py-4 text-right tabular-nums">
                        {formatMetric(playerSummary?.damageDealtPerMinute)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5 text-chart-3" aria-hidden="true" />
              Damage comparison
            </CardTitle>
            <p className="text-sm text-muted-foreground">Damage dealt versus damage absorbed.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex gap-5 text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Dealt
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-destructive/70" />
                Taken
              </span>
            </div>
            {replay.players.map((player) => {
              const native = metricsBySlot.get(player.slot)
              const dealt = native?.damageDealt ?? 0
              const taken = native?.damageTaken ?? 0
              return (
                <div key={player.slot}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-semibold text-foreground">{player.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {dealt.toFixed(1)} / {taken.toFixed(1)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(dealt / maxDamage) * 100}%` }}
                      />
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-destructive/70"
                        style={{ width: `${(taken / maxDamage) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-chart-4" aria-hidden="true" />
              Movement & dodges
            </CardTitle>
            <p className="text-sm text-muted-foreground">How each player spent movement time and defensive actions.</p>
          </CardHeader>
          <CardContent className="space-y-5">
            {replay.players.map((player) => {
              const native = metricsBySlot.get(player.slot)
              const playerSummary = summaryBySlot.get(player.slot)
              const movementTotal = (native?.groundTimeMs ?? 0) + (native?.airTimeMs ?? 0) + (native?.wallTimeMs ?? 0)
              const ground =
                playerSummary?.groundTimeShare ?? (movementTotal > 0 ? (native?.groundTimeMs ?? 0) / movementTotal : 0)
              const air =
                playerSummary?.airTimeShare ?? (movementTotal > 0 ? (native?.airTimeMs ?? 0) / movementTotal : 0)
              const wall =
                playerSummary?.wallTimeShare ?? (movementTotal > 0 ? (native?.wallTimeMs ?? 0) / movementTotal : 0)
              return (
                <div key={player.slot}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">{player.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatMetric(playerSummary?.dodgesPerMinute)} dodges/min ·{' '}
                      {formatShare(playerSummary?.airDodgeShare)} air
                    </span>
                  </div>
                  <div
                    className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted"
                    aria-label={`${player.name} movement split`}
                  >
                    <div
                      className="bg-primary"
                      style={{ width: `${ground * 100}%` }}
                      title={`Ground ${formatShare(ground)}`}
                    />
                    <div className="bg-chart-3" style={{ width: `${air * 100}%` }} title={`Air ${formatShare(air)}`} />
                    <div
                      className="bg-chart-4"
                      style={{ width: `${wall * 100}%` }}
                      title={`Wall ${formatShare(wall)}`}
                    />
                  </div>
                </div>
              )
            })}
            <div className="flex flex-wrap gap-4 border-t border-border/60 pt-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Ground
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-chart-3" />
                Air
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-chart-4" />
                Wall
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Knockout timeline
          </CardTitle>
          <p className="text-sm text-muted-foreground">The sequence that decided the match.</p>
        </CardHeader>
        <CardContent>
          {replay.koTimeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No knockouts were recorded.</p>
          ) : (
            <>
              <svg viewBox="0 0 1000 92" className="h-24 w-full" role="img" aria-label="Knockout event timeline">
                <line x1="20" x2="980" y1="44" y2="44" className="stroke-border" strokeWidth="4" />
                {replay.koTimeline.map((event, index) => (
                  <circle
                    key={`${event.timestampMs}-${event.victimSlot}-${index}`}
                    cx={timelineX(event.timestampMs, replay.durationMs)}
                    cy="44"
                    r="10"
                    className="fill-primary stroke-background"
                    strokeWidth="4"
                  />
                ))}
              </svg>
              <ol className="mt-4 grid gap-2 sm:grid-cols-2">
                {replay.koTimeline.map((event, index) => {
                  const scorer = event.scoringSlot === null ? null : playerBySlot.get(event.scoringSlot)
                  const victim = playerBySlot.get(event.victimSlot)
                  return (
                    <li
                      key={`${event.timestampMs}-${event.victimSlot}-${index}`}
                      className="flex items-center gap-3 rounded-md border border-border/70 bg-muted/20 p-3 text-sm"
                    >
                      <span className="font-mono text-xs font-bold text-primary">
                        {formatDuration(event.timestampMs)}
                      </span>
                      <span>
                        <strong>{scorer?.name ?? 'Environment'}</strong> knocked out {victim?.name ?? 'Unknown player'}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </CardContent>
      </Card>

      {equipment && equipment.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Equipment usage</CardTitle>
            <p className="text-sm text-muted-foreground">Share of tracked held time by player and item.</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Player</th>
                    <th className="px-3 py-3">Equipment</th>
                    <th className="px-5 py-3 text-right">Held time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {equipment.map((item) => (
                    <tr key={`${item.slot}-${item.key}`}>
                      <th className="px-5 py-3 font-semibold" scope="row">
                        {playerBySlot.get(item.slot)?.name ?? `Slot ${item.slot + 1}`}
                      </th>
                      <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{item.key}</td>
                      <td className="px-5 py-3 text-right font-bold tabular-nums">{formatShare(item.heldTimeShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <details className="rounded-lg border border-border bg-card/60 p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
          Data quality & provenance
        </summary>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-muted-foreground">
            <dt>Processor</dt>
            <dd className="text-right font-mono text-foreground">{core.provenance.processorVersion}</dd>
            <dt>Game build</dt>
            <dd className="text-right font-mono text-foreground">{core.provenance.gameBuild}</dd>
            <dt>Collector</dt>
            <dd className="text-right font-mono text-foreground">{core.provenance.collector}</dd>
            <dt>Profile</dt>
            <dd className="text-right font-mono text-foreground">{core.provenance.qualificationProfile}</dd>
          </dl>
          <div>
            <p className="font-semibold text-foreground">Known limitations</p>
            <ul className="mt-2 space-y-2 text-muted-foreground">
              {core.limitations.map((limitation, index) => (
                <li key={`${limitation.code}-${index}`}>{limitation.text}</li>
              ))}
            </ul>
          </div>
        </div>
      </details>

      <p className="text-xs text-muted-foreground">
        Replay-deterministic analysis from processor {core.provenance.processorVersion}.
      </p>
    </article>
  )
}
