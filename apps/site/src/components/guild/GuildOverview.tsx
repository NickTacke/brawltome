import type { ClanProfileContract, ClanStandingContract } from '@brawltome/contracts'
import { formatWhole } from '../../lib'
import { placeColours, sectionTitleStyle } from './guild-styles'
import { Laurel } from './Laurel'
import { legendAvatarUrl } from './legend-avatar-url'
import { PlayerLink } from './PlayerLink'
import { RankedStatistics } from './RankedStatistics'
import type { RankedRecord } from './ranked-statistics'
import { type RankedMember, topContributors } from './roster'

const podiumRings: Record<number, string> = { 1: 'ring-gold/70', 2: 'ring-silver/50', 3: 'ring-bronze/60' }
const lastLaurelRank = 10

type RankEntry = { label: string; rank: number | null; value: string | null }

function rankEntries(clan: ClanProfileContract, standing: ClanStandingContract | null): RankEntry[] {
  const guildPoints = clan.guildPoints === null ? null : formatWhole(clan.guildPoints)

  return [
    { label: 'Guild points', rank: standing?.guildPointsRank ?? null, value: guildPoints },
    { label: 'Lifetime XP', rank: standing?.lifetimeXpRank ?? null, value: formatWhole(clan.clanLifetimeXp) },
  ]
}

function rankText(rank: number | null): string {
  return rank === null ? '—' : `#${formatWhole(rank)}`
}

function placeColour(rank: number | null, fallback: string): string {
  return (rank && placeColours[rank]) || fallback
}

function RankRow({ label, rank, value }: RankEntry) {
  const hasLaurels = rank !== null && rank <= lastLaurelRank
  const laurelColour = placeColour(rank, 'text-soft/45')

  return (
    <div className="min-w-0 text-center xl:flex xl:h-[4.5rem] xl:items-center xl:gap-3 xl:text-left">
      <div className="flex h-16 items-center justify-center gap-1 xl:w-36 xl:shrink-0 xl:justify-start">
        {hasLaurels && <Laurel colour={laurelColour} />}
        <span className={`text-3xl font-black tracking-tight sm:text-4xl ${placeColour(rank, 'text-strong')}`}>
          {rankText(rank)}
        </span>
        {hasLaurels && <Laurel colour={laurelColour} flip />}
      </div>
      <div className="xl:min-w-0">
        <div className="mt-1 text-sm font-semibold text-text xl:mt-0">{label}</div>
        {value && <div className="font-mono text-xs text-soft sm:text-sm">{value}</div>}
      </div>
    </div>
  )
}

function Ranking({ clan, standing }: { clan: ClanProfileContract; standing: ClanStandingContract | null }) {
  return (
    <section className="min-w-0">
      <h2 className={sectionTitleStyle}>Ranking</h2>
      <div className="mt-4 grid grid-cols-2 gap-2 lg:mt-8 lg:mb-6 xl:mt-1.5 xl:-mb-3 xl:grid-cols-1 xl:gap-0">
        {rankEntries(clan, standing).map((entry) => (
          <RankRow key={entry.label} {...entry} />
        ))}
      </div>
    </section>
  )
}

function PodiumStep({ member, place }: { member: RankedMember; place: number }) {
  const avatarSize = place === 1 ? 'size-20' : 'size-16'

  return (
    <div className="group relative flex min-w-0 flex-col items-center text-center">
      <div className={`overflow-hidden rounded-lg bg-raised ring-2 ${podiumRings[place]} ${avatarSize}`}>
        <img src={legendAvatarUrl(member.mainLegend)} alt="" className="size-full object-cover object-top" />
      </div>
      <PlayerLink
        playerId={member.brawlhallaId}
        className="mt-2.5 block max-w-full truncate font-bold text-strong transition-colors group-hover:text-primary after:absolute after:inset-0"
      >
        {member.displayName}
      </PlayerLink>
      <div className="flex items-center gap-1.5 font-mono text-xs whitespace-nowrap text-soft sm:text-sm">
        <span className={`font-sans font-black ${placeColours[place]}`}>{place}</span>
        {formatWhole(member.guildPoints ?? '0')}
      </div>
    </div>
  )
}

function PodiumSlot({ member, place }: { member: RankedMember | undefined; place: number }) {
  return member ? <PodiumStep member={member} place={place} /> : <div />
}

function Podium({ members }: { members: RankedMember[] }) {
  const [first, second, third] = topContributors(members)

  return (
    <section className="min-w-0 border-t border-line/50 pt-7 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12 xl:border-t xl:border-l-0 xl:border-line/70 xl:pt-7 xl:pl-0">
      <h2 className={sectionTitleStyle}>Top contributors</h2>
      {!first && <p className="mt-4 text-soft">No contributors yet.</p>}
      {first && (
        <div className="mt-4 grid grid-cols-3 items-end gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)] xl:gap-2">
          <PodiumSlot member={second} place={2} />
          <PodiumSlot member={first} place={1} />
          <PodiumSlot member={third} place={3} />
        </div>
      )}
    </section>
  )
}

type GuildOverviewProps = {
  clan: ClanProfileContract
  standing: ClanStandingContract | null
  members: RankedMember[]
  record: RankedRecord
  hasAllSummaries: boolean
}

export function GuildOverview({ clan, standing, members, record, hasAllSummaries }: GuildOverviewProps) {
  return (
    <div className="grid gap-y-7 lg:grid-cols-2 lg:[&>*:first-child]:pr-12 xl:sticky xl:top-10 xl:grid-cols-1 xl:[&>*:first-child]:pr-0">
      <Ranking clan={clan} standing={standing} />
      <Podium members={members} />
      {hasAllSummaries && <RankedStatistics members={members} record={record} />}
    </div>
  )
}
