import { createFileRoute, notFound } from '@tanstack/react-router'
import { GuildHeader } from '../components/guild/GuildHeader'
import { GuildOverview } from '../components/guild/GuildOverview'
import { MemberTable } from '../components/guild/MemberTable'
import { rankedRecord } from '../components/guild/ranked-statistics'
import { rankMembers } from '../components/guild/roster'
import { RefreshChallenge } from '../components/refresh/RefreshChallenge'
import { isGuildRefreshed, isGuildStale } from '../components/refresh/staleness'
import { useLiveRefresh } from '../components/refresh/use-live-refresh'
import { fixEncoding, parseEntityId } from '../lib'
import { getGuild, refreshGuild } from '../server/guilds'
import type { GuildPage as GuildPageData } from '../server/load-guild'

function pageTitle(guildName: string | undefined, status: string): string {
  if (guildName) return `${fixEncoding(guildName)} | BrawlTome`

  return status === 'error' ? 'Guild unavailable | BrawlTome' : 'Guild not found | BrawlTome'
}

export const Route = createFileRoute('/guild/$id')({
  loader: async ({ params }) => {
    const guildId = parseEntityId(params.id)

    if (guildId === null) throw notFound()

    const guild = await getGuild({ data: guildId })

    if (!guild) throw notFound()

    return guild
  },
  head: ({ loaderData, match }) => ({ meta: [{ title: pageTitle(loaderData?.clan.clanName, match.status) }] }),
  notFoundComponent: GuildNotFound,
  errorComponent: GuildLoadError,
  component: GuildRoute,
})

function GuildNotFound() {
  return (
    <div className="py-16">
      <h1 className="text-heading font-semibold">Guild not found</h1>
      <p className="mt-2 text-soft">Check the guild id, or search for the guild by a member's name.</p>
    </div>
  )
}

// a fixed message, the error itself is for the server log
function GuildLoadError() {
  const { id } = Route.useParams()

  return (
    <div className="py-16">
      <h1 className="text-heading font-semibold">This guild couldn't be loaded</h1>
      <p className="mt-2 text-soft">Something went wrong on our side. It's usually back in a moment.</p>
      <a
        href={`/guild/${encodeURIComponent(id)}`}
        className="mt-4 inline-block text-primary underline underline-offset-4"
      >
        Try again
      </a>
    </div>
  )
}

function useLiveGuild(page: GuildPageData) {
  const guildId = page.clan.clanId

  return useLiveRefresh({
    initial: page,
    isStale: (current) => isGuildStale(current.clan, new Date(current.loadedAt)),
    isRefreshed: (baseline, current) => isGuildRefreshed(baseline.clan, current.clan, new Date(baseline.loadedAt)),
    load: () => getGuild({ data: guildId }),
    refresh: (turnstileToken) => refreshGuild({ data: { id: guildId, turnstileToken } }),
  })
}

function GuildPage(page: GuildPageData) {
  const live = useLiveGuild(page)
  const { clan, standing, summaries, hasAllSummaries, loadedAt } = live.data
  const members = rankMembers(clan.members, summaries)
  const record = rankedRecord(summaries, new Date(loadedAt))

  return (
    <div className="divide-y divide-line/50 [--gutter:max(4rem,calc((100vw-57px-1080px-380px)/3))] md:px-[max(0px,calc(40px-max(0px,(100vw-1209px)/2)))] max-xl:[&>*]:py-7 max-xl:[&>*:first-child]:pt-0 max-xl:[&>*:first-child]:pb-10 max-xl:[&>*:last-child]:pt-4 max-xl:[&>*:last-child]:pb-0 xl:relative xl:left-1/2 xl:grid xl:w-[calc(100vw-57px)] xl:-translate-x-1/2 xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_1fr] xl:divide-y-0 xl:px-(--gutter)">
      <div className="min-w-0 xl:col-start-1 xl:row-start-1 xl:pr-(--gutter) xl:pb-8">
        <GuildHeader clan={clan} refresh={{ status: live.status, onRetry: live.retry }} />
        <RefreshChallenge challenge={live.challenge} />
      </div>
      <aside className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:mt-9 xl:border-l xl:border-line/50 xl:pl-12">
        <GuildOverview
          key={clan.clanId}
          clan={clan}
          standing={standing}
          members={members}
          record={record}
          hasAllSummaries={hasAllSummaries}
        />
      </aside>
      <div className="min-w-0 xl:col-start-1 xl:row-start-2 xl:mr-(--gutter) xl:border-t xl:border-line/50 xl:pt-4">
        <MemberTable key={clan.clanId} members={members} />
      </div>
    </div>
  )
}

function GuildRoute() {
  const page = Route.useLoaderData()

  return <GuildPage key={page.clan.clanId} {...page} />
}
