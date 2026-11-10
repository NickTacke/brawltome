import { createFileRoute } from '@tanstack/react-router'
import { GuildRanking } from '../components/guilds/GuildRanking'
import { parseGuildRankingSearch } from '../components/guilds/guild-ranking-search'
import { getGuildRanking } from '../server/guild-ranking'

export const Route = createFileRoute('/guilds')({
  validateSearch: parseGuildRankingSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: ({ deps }) => getGuildRanking({ data: deps.page }),
  head: () => ({ meta: [{ title: 'Guilds | BrawlTome' }] }),
  component: Guilds,
})

function Guilds() {
  const ranking = Route.useLoaderData()
  const { page } = Route.useLoaderDeps()
  const navigate = Route.useNavigate()

  function changePage(nextPage: number) {
    void navigate({ search: { page: nextPage > 1 ? nextPage : undefined } })
  }

  return <GuildRanking ranking={ranking} page={page} onPage={changePage} />
}
