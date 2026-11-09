import type { ClanProfileContract } from '@brawltome/contracts'
import { fixEncoding, formatDay, formatWhole, timeAgo } from '../../lib'
import { RefreshStatus, type RefreshStatusProps } from '../refresh/RefreshStatus'
import { socialLinks } from '../social-links'

const discordInvitePattern = /^[A-Za-z0-9-]+$/

function discordInviteUrl(code: string | null): string | null {
  if (!code || !discordInvitePattern.test(code)) return null

  return `https://discord.gg/${code}`
}

const bullet = <span className="hidden sm:inline">•</span>

function RecruitingStatus() {
  return (
    <span className="inline-flex items-center gap-1.5 text-text">
      <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth="1.5" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.34 15.84q-1.033-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75q1.057 0 2.09-.09m0 9.18q.381 1.445.985 2.783c.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a21 21 0 0 1-1.44-4.282m3.102.069a18 18 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.9 23.9 0 0 1 8.835 2.535M10.34 6.66a23.9 23.9 0 0 0 8.835-2.535m0 0A24 24 0 0 0 18.795 3m.38 1.125a24 24 0 0 1 1.014 5.395m-1.014 8.855q-.177.57-.38 1.125m.38-1.125a24 24 0 0 0 1.014-5.395m0-3.46a2.25 2.25 0 0 1 0 3.46m0-3.46a24 24 0 0 1 0 3.46"
        />
      </svg>
      Recruiting
    </span>
  )
}

function DiscordLink({ url }: { url: string }) {
  const discordIcon = socialLinks.find(({ label }) => label === 'Discord')?.svg

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-soft transition-colors hover:text-strong [&>svg]:size-4"
    >
      {discordIcon}
      Guild Discord
    </a>
  )
}

export function GuildHeader({ clan, refresh }: { clan: ClanProfileContract; refresh: RefreshStatusProps }) {
  const message = fixEncoding(clan.notice).trim()
  const updatedAt = clan.profile.lastSuccessAt
  const discordUrl = discordInviteUrl(clan.discordInviteCode)
  const memberCount = clan.members.length

  return (
    <div className="min-w-0">
      <h1 className="min-w-0 pr-11 text-3xl font-black tracking-tight text-strong [overflow-wrap:anywhere] max-sm:line-clamp-2 sm:h-14 sm:truncate sm:text-5xl md:pr-0">
        {fixEncoding(clan.clanName)}
      </h1>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-soft">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {clan.isRecruiting && (
            <>
              <RecruitingStatus />
              {bullet}
            </>
          )}
          <div>
            {formatWhole(memberCount)} {memberCount === 1 ? 'member' : 'members'}
          </div>
          {bullet}
          <div>Created {formatDay(clan.clanCreateDate)}</div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {(updatedAt || refresh.status !== 'idle') && (
            <div>
              {updatedAt && <span suppressHydrationWarning>Updated {timeAgo(updatedAt)}</span>}
              <RefreshStatus {...refresh} hasTextBefore={Boolean(updatedAt)} />
            </div>
          )}
          {updatedAt && discordUrl && bullet}
          {discordUrl && <DiscordLink url={discordUrl} />}
        </div>
      </div>

      {message && (
        <p className="mt-4 line-clamp-3 max-w-2xl whitespace-pre-line text-text [overflow-wrap:anywhere]">{message}</p>
      )}
    </div>
  )
}
