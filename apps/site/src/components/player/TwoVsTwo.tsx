import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { MobileCollapse } from './MobileCollapse'
import { formatGrouped, rankBanner, tierName, winPercent, winRateColour } from './player-format'
import { sectionBody, sectionTitle } from './player-styles'
import { RatingAndPeak } from './RatingAndPeak'
import { SplitRecord } from './SplitRecord'
import {
  bestTeam,
  type CombinedRecord,
  combinedRecord,
  type FixedTeam,
  noStanding,
  type SoloQueueEntry,
  type Standing,
  soloQueueStanding,
  teammateOf,
} from './side-summary'

type Entry = { key: string; heading: string; name: ReactNode | null; standing: Standing }

function WinRateOf({ wins, games }: { wins: number; games: number }) {
  const percent = winPercent(wins, games)

  return (
    <span className="font-mono text-sm whitespace-nowrap text-soft">
      <span className={`font-bold ${winRateColour(percent)}`}>{percent.toFixed(1)}%</span> of {formatGrouped(games)}
    </span>
  )
}

function RowResult({ standing }: { standing: Standing }) {
  if (standing.games === 0) return <p className="text-sm text-soft">No games this season</p>

  return (
    <>
      <RatingAndPeak
        standing={standing}
        ratingClass="text-[1.75rem] xl:[@media(max-height:880px)]:text-2xl"
        peakClass="text-base"
        labelClass="max-[420px]:hidden"
      />
      <div className="mt-1">
        <WinRateOf wins={standing.wins} games={standing.games} />
      </div>
    </>
  )
}

function NamedRow({ heading, name, standing }: Omit<Entry, 'key'>) {
  return (
    <div className="flex items-center gap-3.5 py-2.5 first:pt-0 last:pb-0 xl:[@media(max-height:880px)]:py-1.5">
      <img
        src={rankBanner(standing.tier)}
        alt=""
        className="h-20 w-14 shrink-0 object-contain xl:[@media(max-height:880px)]:h-16! xl:[@media(max-height:880px)]:w-12! [@media(min-height:960px)]:h-24 [@media(min-height:960px)]:w-[4.25rem]"
      />
      <div className="min-w-0 flex-1">
        {name && <div className="truncate text-xs font-bold text-soft">{heading}</div>}
        <div className="truncate text-lg leading-snug font-bold text-text">{name ?? heading}</div>
        <div className="truncate text-sm font-semibold text-soft">{tierName(standing.tier)}</div>
      </div>
      <div className="shrink-0 text-right">
        <RowResult standing={standing} />
      </div>
    </div>
  )
}

function bestTeamEntry(teams: FixedTeam[], playerId: number): Entry | null {
  const team = bestTeam(teams)

  if (!team) return null

  const partner = teammateOf(team, playerId)

  const name = (
    <Link
      to="/player/$id"
      params={{ id: String(partner.id) }}
      className="inline-block max-w-full truncate align-bottom transition-colors hover:text-primary"
    >
      {partner.name}
    </Link>
  )

  return { key: 'team', heading: 'Best team', name, standing: team }
}

function TeamCounts({ totals }: { totals: CombinedRecord }) {
  return (
    <div className="text-[0.8125rem] whitespace-nowrap text-soft tabular-nums">
      <span className="font-black text-strong">{formatGrouped(totals.teams)}</span>{' '}
      {totals.teams === 1 ? 'team' : 'teams'} ·{' '}
      <span className="font-black text-strong">{formatGrouped(totals.games)}</span> games
    </div>
  )
}

type TwoVsTwoProps = { teams: FixedTeam[]; soloQueue: SoloQueueEntry[]; playerId: number }

export function TwoVsTwo({ teams, soloQueue, playerId }: TwoVsTwoProps) {
  const best = bestTeamEntry(teams, playerId)
  // solo queue always has a row, like ranked 1v1, so a player who never queued reads as unranked instead of missing
  const solo = soloQueueStanding(soloQueue) ?? noStanding
  const soloEntry: Entry = { key: 'solo', heading: 'Solo queue', name: null, standing: solo }
  const entries = [best, soloEntry].filter((entry) => entry !== null)

  const totals = combinedRecord(teams)
  const hasTeams = totals.teams > 0

  return (
    <section data-twos>
      <MobileCollapse
        title="Ranked 2v2"
        titleClassName={sectionTitle}
        headerEnd={hasTeams ? <TeamCounts totals={totals} /> : undefined}
      >
        <div className={sectionBody}>
          {hasTeams && (
            <div className="mb-3">
              <SplitRecord standing={totals} />
            </div>
          )}
          <div className="divide-y divide-line/30">
            {entries.map(({ key, heading, name, standing }) => (
              <NamedRow key={key} heading={heading} name={name} standing={standing} />
            ))}
          </div>
        </div>
      </MobileCollapse>
    </section>
  )
}
