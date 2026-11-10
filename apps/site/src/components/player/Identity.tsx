import { Link } from '@tanstack/react-router'
import { Fragment, type ReactNode } from 'react'
import { fixEncoding, timeAgo } from '../../lib'
import type { PlayerData } from '../../server/load-player'
import { legendAvatarUrl } from '../guild/legend-avatar-url'
import { isVerifiedPlayer } from '../rail/rail-account'
import { useRailAccount } from '../rail/use-rail-account'
import { type RefreshStatusProps, UpdatedTime } from '../refresh/RefreshStatus'
import { regionOption } from '../regions'
import { AliasesButton } from './AliasesButton'
import { HoverReveal } from './HoverReveal'
import { PinButton } from './PinButton'
import { formatHours } from './player-format'

type IdentityProps = { player: PlayerData; loadedAt: string; refresh: RefreshStatusProps }

function RegionFlag({ region }: { region: string | null }) {
  const option = regionOption(region)

  if (!option) return null

  return (
    <HoverReveal label={option.label} trigger={option.flag}>
      <div className="rounded-sm px-2 py-1 text-sm font-medium whitespace-nowrap text-text">{option.label}</div>
    </HoverReveal>
  )
}

function nameSizeStyle(name: string): string {
  if (name.length <= 12) return 'text-4xl'

  return name.length <= 20 ? 'text-3xl' : 'text-2xl'
}

type NameDetailsProps = { aliases: string[]; region: string | null; playerId: number }

/** The row under the name: aliases, region and the pin button, whichever apply, with a dot between each. */
export function NameDetails({ aliases, region, playerId }: NameDetailsProps) {
  const account = useRailAccount()
  const parts: { key: string; content: ReactNode }[] = []

  if (aliases.length > 0) parts.push({ key: 'aliases', content: <AliasesButton aliases={aliases} /> })

  if (regionOption(region)) {
    const content = (
      <span className="flex items-center gap-1.5">
        Region: <RegionFlag region={region} />
      </span>
    )

    parts.push({ key: 'region', content })
  }

  if (!isVerifiedPlayer(account, playerId)) parts.push({ key: 'pin', content: <PinButton playerId={playerId} /> })

  if (parts.length === 0) return null

  return (
    <div className="mt-1 flex items-center gap-2 text-sm text-soft">
      {parts.map(({ key, content }, index) => (
        <Fragment key={key}>
          {index > 0 && <span aria-hidden="true">·</span>}
          {content}
        </Fragment>
      ))}
    </div>
  )
}

function mainLegendKey(player: PlayerData): string | null {
  const legends = player.career?.snapshot?.legends ?? []
  const [mostPlayed] = [...legends].sort((left, right) => right.xp - left.xp)

  return mostPlayed?.legendNameKey ?? player.bestLegendNameKey
}

function PlaytimeAndFreshness({ player, loadedAt, refresh }: IdentityProps) {
  const matchTime = player.career?.snapshot?.combat.matchTime
  const lastUpdate = player.currentSeason?.lastSuccessAt ?? player.career?.lastSuccessAt

  if (matchTime === undefined && !lastUpdate && refresh.status === 'idle') return null

  return (
    <div className="mt-0.5 text-sm text-soft">
      {matchTime !== undefined && <span className="font-semibold text-text">{formatHours(matchTime)} played</span>}
      <UpdatedTime
        {...refresh}
        updatedText={lastUpdate ? `Updated ${timeAgo(lastUpdate, new Date(loadedAt))}` : null}
        hasTextBefore={matchTime !== undefined}
      />
    </div>
  )
}

export function Identity({ player, loadedAt, refresh }: IdentityProps) {
  const name = fixEncoding(player.name)
  const region = player.currentSeason?.snapshot?.oneVsOne.region ?? null

  return (
    <div className="flex items-center gap-4">
      <img
        src={legendAvatarUrl(mainLegendKey(player))}
        alt=""
        className="size-24 shrink-0 rounded-xl bg-raised object-cover object-top 2xl:size-28"
      />
      <div className="min-w-0 flex-1">
        <h1
          className={`min-w-0 pr-11 leading-[1.15] font-black tracking-tight text-strong [overflow-wrap:anywhere] md:pr-0 ${nameSizeStyle(name)}`}
        >
          {name}
        </h1>
        <NameDetails aliases={player.aliases} region={region} playerId={player.brawlhallaId} />
        {player.clan && (
          <Link
            to="/guild/$id"
            params={{ id: String(player.clan.clanId) }}
            className="mt-1 block truncate font-semibold text-primary hover:underline"
          >
            {fixEncoding(player.clan.clanName)}
          </Link>
        )}
        <PlaytimeAndFreshness player={player} loadedAt={loadedAt} refresh={refresh} />
      </div>
    </div>
  )
}
