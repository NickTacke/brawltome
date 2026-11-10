import { createFileRoute, useRouterState } from '@tanstack/react-router'
import { HomeFilters } from '../components/home/HomeFilters'
import { type BoardRegion, defaultMode, parseRegion } from '../components/home/home-filters'
import { rememberRegion } from '../components/home/region-cookie'
import { LeaderboardBoard } from '../components/leaderboard/LeaderboardBoard'
import { parseLeaderboardSearch } from '../components/leaderboard/leaderboard-search'
import { useSlowNavigation } from '../components/use-slow-navigation'
import { getLeaderboardPage } from '../server/leaderboard'

export const Route = createFileRoute('/leaderboard')({
  validateSearch: parseLeaderboardSearch,
  loaderDeps: ({ search }) => ({ mode: search.mode ?? defaultMode, region: search.region, page: search.page ?? 1 }),
  loader: ({ deps }) => getLeaderboardPage({ data: deps }),
  head: () => ({ meta: [{ title: 'Leaderboard | BrawlTome' }] }),
  component: Leaderboard,
})

// a new bracket or region starts again from the first page
function useBoardFilters(shownRegion: BoardRegion) {
  // the location changes as soon as a filter is picked, the route's own search only once the board has loaded
  const locationSearch = useRouterState({ select: (state) => state.location.search })
  const search = parseLeaderboardSearch(locationSearch)
  const mode = search.mode ?? defaultMode
  const region = search.region ?? shownRegion
  const navigate = Route.useNavigate()

  function changeRegion(picked: string) {
    const nextRegion = parseRegion(picked)

    if (!nextRegion) return

    rememberRegion(nextRegion)
    void navigate({ search: (previous) => ({ ...previous, region: nextRegion, page: undefined }), resetScroll: false })
  }

  function changeMode(nextMode: string) {
    const nextSearch = (previous: Record<string, unknown>) =>
      parseLeaderboardSearch({ ...previous, mode: nextMode, page: undefined })

    void navigate({ search: nextSearch, resetScroll: false })
  }

  return { mode, filters: <HomeFilters mode={mode} region={region} onMode={changeMode} onRegion={changeRegion} /> }
}

function Leaderboard() {
  const { region, board } = Route.useLoaderData()
  const { page } = Route.useLoaderDeps()
  const { mode, filters } = useBoardFilters(region)
  const isSlow = useSlowNavigation()
  const navigate = Route.useNavigate()

  function changePage(nextPage: number) {
    void navigate({ search: (previous) => ({ ...previous, page: nextPage > 1 ? nextPage : undefined }) })
  }

  return (
    <LeaderboardBoard
      board={board}
      page={page}
      filters={filters}
      isLoading={isSlow}
      avatarCount={mode === '2v2' ? 2 : 1}
      onPage={changePage}
    />
  )
}
