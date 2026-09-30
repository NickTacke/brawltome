'use client'

import type { ReplayJobDetailContract } from '@brawltome/contracts'
import { getLegendById, getLevelById, legendSlug, normalizeWeaponName } from '@brawltome/game-data'
import { Avatar, AvatarFallback, AvatarImage } from '@brawltome/ui'
import { Download, Trophy } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { getWeaponIcon } from '../../components/player/shared'
import { buildReplayReport, formatCount, formatRate } from './replay-report'

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1_000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function timelineX(timestampMs: number, durationMs: number): number {
  const progress = durationMs > 0 ? timestampMs / durationMs : 0
  return 20 + Math.min(Math.max(progress, 0), 1) * 960
}

function formatMetric(value: number | null | undefined, suffix = ''): string {
  if (value === null || value === undefined) return '—'
  return `${value.toFixed(2).replace(/\.?(0)+$/, '')}${suffix}`
}

function weaponDisplayName(key: string): string {
  return key === 'RocketLance' ? 'Rocket Lance' : normalizeWeaponName(key)
}

type ReplayMatch = NonNullable<ReplayJobDetailContract['result']>['core']['replay']

const PLAYLIST_MODE_LABELS: Record<number, string> = {
  7: 'Ranked 2v2',
}

export function formatGameMode(replay: ReplayMatch): string {
  const knownMode = PLAYLIST_MODE_LABELS[replay.playlistId]
  if (knownMode) return knownMode
  if (!replay.matchSettings.teamMode) return replay.players.length === 2 ? '1v1' : `${replay.players.length}-player`

  const teamSizes = new Map<number, number>()
  for (const player of replay.players) teamSizes.set(player.teamId, (teamSizes.get(player.teamId) ?? 0) + 1)
  const playersPerTeam = Math.max(...teamSizes.values(), 1)
  return `${playersPerTeam}v${playersPerTeam}`
}

function formatShare(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
}

function formatPositioningShare(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

export function formatPositioning(air: number | null, ground: number | null, wall: number | null): string {
  return `Air ${formatPositioningShare(air)} · Ground ${formatPositioningShare(ground)} · Wall ${formatPositioningShare(wall)}`
}

type ReplayReport = ReturnType<typeof buildReplayReport>
type ReportPlayer = ReplayReport['players'][number]

type MatchSide = {
  teamId: number
  players: ReportPlayer[]
  damageDealt: number | null
  damageTaken: number | null
  teamDamage: number | null
  damageTakenPerDeath: number | null
  damageDealtPerOpening: number | null
  won: boolean
}

type SideName = 'left' | 'right'
type PlayerTone = 'primary' | 'danger'

function sumMetric(players: ReportPlayer[], select: (player: ReportPlayer) => number | null): number | null {
  const values = players.map(select)
  return values.every((value) => value === null)
    ? null
    : values.reduce<number>((total, value) => total + (value ?? 0), 0)
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null
}

function createMatchSides(report: ReplayReport, winningTeamId: number | null): MatchSide[] {
  const teamIds = [...new Set(report.players.map(({ teamId }) => teamId))].toSorted((left, right) => left - right)
  return teamIds.map((teamId) => {
    const players = report.players.filter((player) => player.teamId === teamId)
    const damageTaken = sumMetric(players, (player) => player.damageTaken)
    const deaths = sumMetric(players, (player) => player.deaths)
    return {
      teamId,
      players,
      damageDealt: sumMetric(players, (player) => player.damageDealt),
      damageTaken,
      teamDamage: sumMetric(players, (player) => player.teamDamageDealt),
      damageTakenPerDeath: ratio(damageTaken, deaths),
      damageDealtPerOpening: null,
      won: winningTeamId !== null && teamId === winningTeamId,
    }
  })
}

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-bold text-foreground">{title}</h3>
    </div>
  )
}

function ComingSoon() {
  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 px-4 py-5 text-center">
      <p className="font-bold text-foreground">Coming soon</p>
    </div>
  )
}

function PlayerName({ player }: { player: ReportPlayer }) {
  const content = <span className="break-words">{player.name}</span>
  if (player.playerId === null || player.playerId <= 0) return content
  return (
    <Link href={`/player/${player.playerId}`} className="transition-colors hover:text-primary">
      {content}
    </Link>
  )
}

function PlayerLane({ side, matchSide }: { side: SideName; matchSide: MatchSide }) {
  const isLeft = side === 'left'
  const avatarPlayer = matchSide.players[0]
  const avatarLegend = avatarPlayer ? getLegendById(avatarPlayer.legendId) : null
  const avatarSlug = avatarLegend ? legendSlug(avatarLegend.heroId, avatarLegend.displayName) : null
  return (
    <div
      className={`flex min-w-0 items-center gap-3 bg-card p-3 ${isLeft ? '' : 'md:flex-row-reverse md:text-right'}`}
      aria-label={`${isLeft ? 'Left' : 'Right'} player lane${matchSide.won ? ', winner' : ''}`}
    >
      {avatarPlayer && (
        <Avatar className="h-9 w-9 shrink-0 rounded-md border border-border bg-muted">
          {avatarSlug && <AvatarImage src={`/images/legends/avatars/${avatarSlug}.png`} alt="" />}
          <AvatarFallback className="rounded-md text-[10px]">{avatarPlayer.slot + 1}</AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0 flex-1">
        {matchSide.players.map((player) => {
          const legend = getLegendById(player.legendId)
          return (
            <div key={player.slot}>
              <div className="flex items-center gap-1.5 text-base font-black text-foreground">
                <PlayerName player={player} />
                {player.won && <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Winner" />}
              </div>
              <p className={`font-mono text-[10px] uppercase ${isLeft ? 'text-primary' : 'text-danger'}`}>
                {legend?.displayName ?? `Legend ${player.legendId}`}
              </p>
            </div>
          )
        })}
      </div>
      <div className="grid shrink-0 grid-cols-3 gap-1 font-mono text-[9px] uppercase text-muted-foreground">
        {matchSide.players.length === 1 && (
          <>
            <div className="min-w-7 text-center">
              <b className="block text-base text-foreground">{formatCount(matchSide.players[0]?.kos)}</b>
              KOs
            </div>
            <div className="min-w-7 text-center">
              <b className="block text-base text-foreground">{formatCount(matchSide.players[0]?.deaths)}</b>
              Deaths
            </div>
            <div className="min-w-7 text-center">
              <b className="block text-base text-foreground">{formatCount(matchSide.players[0]?.suicides)}</b>
              SDs
            </div>
          </>
        )}
        {matchSide.players.length > 1 && (
          <div className="col-span-3 text-right text-xs normal-case">
            {matchSide.players.length} players · {formatCount(sumMetric(matchSide.players, (player) => player.kos))} KOs
          </div>
        )}
      </div>
    </div>
  )
}

function Meter({ value, max, tone }: { value: number | null; max: number; tone: PlayerTone }) {
  if (value === null || max <= 0) return <span className="block h-1.5" />
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/60" aria-hidden="true">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min((value / max) * 100, 100)}%`, backgroundColor: `hsl(var(--${tone}))` }}
      />
    </div>
  )
}

function ComparisonTrack({ left, right }: { left: number | null; right: number | null }) {
  const total = (left ?? 0) + (right ?? 0)
  const leftWidth = total > 0 && left !== null ? (left / total) * 50 : 0
  const rightWidth = total > 0 && right !== null ? (right / total) * 50 : 0
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-muted/60" aria-hidden="true">
      {leftWidth > 0 && <div className="absolute inset-y-0 right-1/2 bg-primary" style={{ width: `${leftWidth}%` }} />}
      {rightWidth > 0 && <div className="absolute inset-y-0 left-1/2 bg-danger" style={{ width: `${rightWidth}%` }} />}
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
    </div>
  )
}

function ComparisonRow({
  left,
  right,
  label,
  better,
}: {
  left: number | null
  right: number | null
  label: string
  better?: 'higher' | 'lower'
}) {
  const leftBetter = left !== null && right !== null && (better === 'lower' ? left < right : left > right)
  const rightBetter = left !== null && right !== null && (better === 'lower' ? right < left : right > left)
  return (
    <div className="border-b border-border/60 py-3 last:border-0">
      <div className="mb-1.5 text-center font-mono text-[10px] uppercase leading-tight text-muted-foreground">
        {label}
      </div>
      <div className="grid grid-cols-[4rem_minmax(0,1fr)_4rem] items-center gap-3">
        <strong className={`font-mono text-sm tabular-nums ${leftBetter ? 'text-primary' : 'text-foreground'}`}>
          {formatMetric(left)}
        </strong>
        <ComparisonTrack left={left} right={right} />
        <strong
          className={`text-right font-mono text-sm tabular-nums ${rightBetter ? 'text-danger' : 'text-foreground'}`}
        >
          {formatMetric(right)}
        </strong>
      </div>
    </div>
  )
}

function DamageGraph() {
  return (
    <section aria-label="Damage over time" className="border-t border-border/70 pt-5">
      <SectionHeading title="Damage over time" />
      <ComingSoon />
    </section>
  )
}

function CombatComparison({ sides, teamMode }: { sides: MatchSide[]; teamMode: boolean }) {
  const left = sides[0]
  const right = sides[1]
  return (
    <section aria-labelledby="combat-heading" className="border-t border-border/70 pt-5">
      <SectionHeading title="Combat" />
      <div id="combat-heading" className="space-y-2">
        <ComparisonRow label="Damage Dealt" left={left?.damageDealt ?? null} right={right?.damageDealt ?? null} />
        <ComparisonRow
          label="Damage Taken"
          left={left?.damageTaken ?? null}
          right={right?.damageTaken ?? null}
          better="lower"
        />
        {teamMode && (
          <ComparisonRow
            label="Team Damage"
            left={left?.teamDamage ?? null}
            right={right?.teamDamage ?? null}
            better="lower"
          />
        )}
        <ComparisonRow
          label="D.Taken / Death"
          left={left?.damageTakenPerDeath ?? null}
          right={right?.damageTakenPerDeath ?? null}
          better="higher"
        />
        <ComparisonRow
          label="D.Dealt / Opening"
          left={left?.damageDealtPerOpening ?? null}
          right={right?.damageDealtPerOpening ?? null}
        />
      </div>
    </section>
  )
}

function sumPowers(powers: ReplayReport['powers'], select: (power: ReplayReport['powers'][number]) => number | null) {
  return powers.length === 0 || powers.every((power) => select(power) === null)
    ? null
    : powers.reduce((sum, power) => sum + (select(power) ?? 0), 0)
}

function MoveTable({ powers, teamMode }: { powers: ReplayReport['powers']; teamMode: boolean }) {
  if (powers.length === 0) return <ComingSoon />
  return (
    <div className="overflow-x-auto border-t border-border/60 px-3 py-2">
      <table className="min-w-[34rem] w-full text-left text-xs">
        <thead className="font-mono text-[10px] uppercase text-muted-foreground">
          <tr>
            <th className="py-1.5">Move</th>
            <th className="px-2 py-1.5 text-right">Uses</th>
            <th className="px-2 py-1.5 text-right">Hits</th>
            <th className="px-2 py-1.5 text-right">KOs</th>
            <th className="px-2 py-1.5 text-right">Damage</th>
            <th className="px-2 py-1.5 text-right">Dmg/hit</th>
            <th className="px-2 py-1.5 text-right">Dmg/use</th>
            {teamMode && <th className="px-2 py-1.5 text-right">Team dmg</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {powers.map((power) => (
            <tr key={`${power.slot}-${power.equipmentKey}-${power.powerKey}`}>
              <th className="py-1.5 font-mono font-medium text-foreground" scope="row">
                {power.powerKey}
              </th>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatCount(power.uses)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatCount(power.enemyHits)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatCount(power.enemyKOs)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatMetric(power.enemyDamage)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatMetric(power.damagePerHit)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatMetric(power.damagePerUse)}</td>
              {teamMode && (
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatMetric(power.teamDamage)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WeaponGroups({
  player,
  report,
  teamMode,
  tone,
}: { player: ReportPlayer; report: ReplayReport; teamMode: boolean; tone: PlayerTone }) {
  const equipment = report.equipment.filter((item) => item.slot === player.slot)
  if (equipment.length === 0) return <ComingSoon />
  const damageByWeapon = equipment.map((item) =>
    sumPowers(
      report.powers.filter((power) => power.slot === player.slot && power.equipmentKey === item.key),
      (power) => power.enemyDamage,
    ),
  )
  const totalDamage = damageByWeapon.reduce<number>((total, value) => total + (value ?? 0), 0)
  return (
    <div className="overflow-hidden rounded-lg border border-border/70" aria-label={`${player.name} weapon usage`}>
      <div className="grid grid-cols-[minmax(0,1fr)_3.75rem_4.25rem_3.25rem] gap-2 border-b sm:grid-cols-[minmax(0,1fr)_6rem_7rem_5rem] border-border/60 px-3 py-1.5 font-mono text-[10px] uppercase text-muted-foreground">
        <span>Weapon</span>
        <span className="text-right">Held</span>
        <span className="text-right">D.Dealt</span>
        <span className="text-right">D.Taken</span>
      </div>
      {equipment.map((item, index) => {
        const powers = report.powers.filter((power) => power.slot === player.slot && power.equipmentKey === item.key)
        const damage = damageByWeapon[index] ?? null
        return (
          <details key={item.key} className="group border-b border-border/60 last:border-b-0">
            <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_3.75rem_4.25rem_3.25rem] items-center gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_5rem] text-sm hover:bg-muted/20">
              <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
                <span
                  className="font-mono text-muted-foreground transition-transform group-open:rotate-90"
                  aria-hidden="true"
                >
                  ▸
                </span>
                <img
                  src={getWeaponIcon(normalizeWeaponName(item.key))}
                  alt=""
                  className="h-6 w-6 shrink-0 object-contain"
                />
                <span className="truncate">{weaponDisplayName(item.key)}</span>
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                {formatRate(item.heldTimeShare)}
                <Meter value={item.heldTimeShare} max={1} tone={tone} />
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-foreground">
                {formatMetric(damage)}
                <Meter value={damage} max={totalDamage} tone={tone} />
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                {formatMetric(item.damageTaken)}
              </span>
            </summary>
            <MoveTable powers={powers} teamMode={teamMode} />
          </details>
        )
      })}
    </div>
  )
}

function WeaponUsage({ report, teamMode }: { report: ReplayReport; teamMode: boolean }) {
  return (
    <section aria-labelledby="weapon-usage-heading" className="border-t border-border/70 pt-5">
      <SectionHeading title="Weapon usage" />
      <div id="weapon-usage-heading" className="grid gap-6 md:grid-cols-2">
        {report.players.map((player, index) => (
          <WeaponGroups
            key={player.slot}
            player={player}
            report={report}
            teamMode={teamMode}
            tone={index === 0 ? 'primary' : 'danger'}
          />
        ))}
      </div>
    </section>
  )
}

function DodgeBias() {
  return <ComingSoon />
}

function Positioning({ player }: { player: ReportPlayer }) {
  const values = [
    ['Air', player.airTimeShare, 'hsl(var(--chart-3))'],
    ['Ground', player.groundTimeShare, 'hsl(var(--primary))'],
    ['Wall', player.wallTimeShare, 'hsl(var(--chart-4))'],
  ] as const
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="font-bold text-foreground">Positioning</h4>
        <span className="font-mono text-[10px] uppercase text-muted-foreground">{player.name}</span>
      </div>
      <div className="space-y-3">
        {values.map(([label, value, color]) => (
          <div key={label} className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                <span>{label}</span>
              </div>
              <span className="tabular-nums text-foreground">{formatShare(value)}</span>
            </div>
            <div
              className="h-2.5 rounded-full bg-muted/60"
              role="img"
              aria-label={`${player.name} ${label} positioning share: ${formatShare(value)}`}
            >
              {value !== null && value > 0 ? (
                <div className="h-full rounded-full" style={{ width: `${value * 100}%`, backgroundColor: color }} />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MovementTotals({ player }: { player: ReportPlayer }) {
  const values = [
    ['Dodges', formatCount(player.dodges)],
    ['Dashes', formatCount(player.dashes)],
    ['Jumps', formatCount(player.jumps)],
    ['Dash jumps', formatCount(player.dashJumps)],
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {values.map(([label, value]) => (
        <div key={label} className="rounded-md bg-muted/40 px-3 py-2">
          <span className="block font-mono text-[10px] uppercase text-muted-foreground">{label}</span>
          <b className="mt-1 block font-mono text-xl tabular-nums text-foreground">{value}</b>
        </div>
      ))}
    </div>
  )
}

function PlaystylePanel({ player }: { player: ReportPlayer }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
        <h4 className="font-bold text-foreground">{player.name}</h4>
        <span className="font-mono text-[10px] uppercase text-muted-foreground">Movement</span>
      </div>
      <MovementTotals player={player} />
      <div className="grid gap-3 lg:grid-cols-2">
        <DodgeBias />
        <Positioning player={player} />
      </div>
    </div>
  )
}

function Playstyle({ players }: { players: ReportPlayer[] }) {
  const [activeSlot, setActiveSlot] = useState(players[0]?.slot ?? 0)
  const activePlayer = players.find((player) => player.slot === activeSlot) ?? players[0]
  return (
    <section aria-labelledby="playstyle-heading" className="border-t border-border/70 pt-5">
      <SectionHeading title="Playstyle" />
      <div id="playstyle-heading" className="mb-4 grid grid-cols-2 gap-px bg-border/70 md:hidden">
        {players.map((player) => (
          <button
            key={player.slot}
            type="button"
            onClick={() => setActiveSlot(player.slot)}
            className={`px-3 py-2 text-center text-sm font-bold ${activeSlot === player.slot ? 'bg-primary text-primary-foreground' : 'bg-muted/50 text-muted-foreground'}`}
          >
            {player.name}
          </button>
        ))}
      </div>
      <div className="hidden gap-6 md:grid md:grid-cols-2">
        {players.map((player) => (
          <PlaystylePanel key={player.slot} player={player} />
        ))}
      </div>
      {activePlayer && (
        <div className="md:hidden">
          <PlaystylePanel player={activePlayer} />
        </div>
      )}
    </section>
  )
}

function Engagements() {
  return (
    <section aria-label="Engagements" className="border-t border-border/70 pt-5">
      <SectionHeading title="Engagements" />
      <ComingSoon />
    </section>
  )
}

function KnockoutSequence({
  replay,
  report,
}: { replay: NonNullable<ReplayJobDetailContract['result']>['core']['replay']; report: ReplayReport }) {
  const playerBySlot = new Map(replay.players.map((player) => [player.slot, player]))
  return (
    <section aria-labelledby="knockout-heading" className="border-t border-border/70 pt-5">
      <SectionHeading title="Knockout sequence" />
      <div id="knockout-heading" className="rounded-lg border border-border/70 bg-background/40 p-4">
        {report.knockouts.length === 0 ? (
          <ComingSoon />
        ) : (
          <>
            <div className="flex justify-between font-mono text-[10px] uppercase text-muted-foreground">
              <span>0:00</span>
              <span>{formatDuration(replay.durationMs)}</span>
            </div>
            <svg viewBox="0 0 1000 72" className="mt-1 h-16 w-full" role="img" aria-label="Knockout sequence">
              <line x1="20" x2="980" y1="34" y2="34" className="stroke-border" strokeWidth="4" />
              {report.knockouts.map((event) => (
                <circle
                  key={`${event.timestampMs}-${event.victimSlot}-${event.index}`}
                  cx={timelineX(event.timestampMs, replay.durationMs)}
                  cy="34"
                  r="8"
                  className="fill-success stroke-background"
                  strokeWidth="4"
                >
                  <title>{`Knockout at ${formatDuration(event.timestampMs)}`}</title>
                </circle>
              ))}
            </svg>
            <ol className="mt-3 grid gap-1 sm:grid-cols-2">
              {report.knockouts.map((event) => (
                <li
                  key={`${event.timestampMs}-${event.victimSlot}-${event.index}`}
                  className="flex gap-3 border-t border-border/60 px-1 py-2 text-sm"
                >
                  <span className="font-mono text-xs text-primary">{formatDuration(event.timestampMs)}</span>
                  <span>
                    <strong>
                      {event.scoringSlot === null
                        ? 'Environment'
                        : (playerBySlot.get(event.scoringSlot)?.name ?? 'Unknown player')}
                    </strong>{' '}
                    → {playerBySlot.get(event.victimSlot)?.name ?? 'Unknown player'}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  )
}

export function ReplayResultView({ job }: { job: ReplayJobDetailContract }) {
  if (!job.result) return null
  const { core } = job.result
  const replay = core.replay
  const report = buildReplayReport(job)
  const sides = createMatchSides(report, replay.outcome.winningTeamId)
  const map = getLevelById(replay.mapId)

  return (
    <article className="mx-auto -mt-2 w-full max-w-5xl space-y-8 text-foreground" aria-label="Replay analysis">
      <header className="flex flex-col justify-between gap-4 border-b border-border/70 pb-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h2 className="break-words text-3xl font-black tracking-tight text-foreground sm:text-4xl">
            {map?.displayName ?? `Map ${replay.mapId}`}
          </h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[formatDuration(replay.durationMs), formatGameMode(replay), `${replay.matchSettings.lives} stocks`].map(
              (item) => (
                <span
                  key={item}
                  className="rounded-md bg-muted/60 px-2 py-1 font-mono text-[10px] text-muted-foreground"
                >
                  {item}
                </span>
              ),
            )}
          </div>
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted/60"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Save replay
        </button>
      </header>

      {sides.length >= 2 && (
        <div className="grid gap-px overflow-hidden rounded-lg border border-border/70 bg-border/70 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <PlayerLane side="left" matchSide={sides[0]} />
          <div className="hidden place-items-center bg-card px-3 font-mono text-[10px] text-muted-foreground md:grid">
            VS
          </div>
          <PlayerLane side="right" matchSide={sides[1]} />
        </div>
      )}

      <DamageGraph />
      <CombatComparison sides={sides} teamMode={replay.matchSettings.teamMode} />
      <WeaponUsage report={report} teamMode={replay.matchSettings.teamMode} />
      <Playstyle players={report.players} />
      <Engagements />
      <KnockoutSequence replay={replay} report={report} />
    </article>
  )
}
