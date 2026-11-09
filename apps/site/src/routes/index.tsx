import { createFileRoute, useRouterState } from '@tanstack/react-router'
import { HomeFilters } from '../components/home/HomeFilters'
import { HomeHero } from '../components/home/HomeHero'
import { type BoardMode, type BoardRegion, defaultMode, parseMode, parseRegion } from '../components/home/home-filters'
import { LegendsRow } from '../components/home/LegendsRow'
import { PatchNews } from '../components/home/PatchNews'
import { rememberRegion } from '../components/home/region-cookie'
import { TopGuilds } from '../components/home/TopGuilds'
import { TopPlayers } from '../components/home/TopPlayers'
import { useSlowNavigation } from '../components/use-slow-navigation'
import { getMostPlayedLegends, getPatches, getTopGuilds, getTopPlayers } from '../server/home'

type HomeSearch = { mode?: BoardMode; region?: BoardRegion }

// both stay out of the address until picked, a bare / shows the remembered region
function validateSearch(search: Record<string, unknown>): HomeSearch {
  const mode = search.mode === undefined ? undefined : parseMode(search.mode)

  return { mode: mode === defaultMode ? undefined : mode, region: parseRegion(search.region) }
}

export const Route = createFileRoute('/')({
  validateSearch,
  loaderDeps: ({ search }) => ({ mode: search.mode ?? defaultMode, region: search.region }),
  loader: async ({ deps }) => {
    const [board, guilds, mostPlayedLegends, patches] = await Promise.all([
      getTopPlayers({ data: deps }),
      getTopGuilds(),
      getMostPlayedLegends(),
      getPatches(),
    ])

    return { board, guilds, mostPlayedLegends, patches }
  },
  component: Home,
})

// wider than the main column on large screens, lined up with the footer
const wideLayout = 'xl:relative xl:left-1/2 xl:w-[min(1400px,calc(100vw-185px))] xl:-translate-x-1/2'

const halvesStyle =
  'grid gap-y-8 xl:grid-cols-2 xl:divide-x xl:divide-line/50 xl:[&>*:first-child]:pr-12 xl:[&>*:last-child]:pl-12'

function Home() {
  const { board, guilds, mostPlayedLegends, patches } = Route.useLoaderData()
  const isSlow = useSlowNavigation()

  // the location changes as soon as a filter is picked, the route's own search only once the board has loaded
  const locationSearch = useRouterState({ select: (state) => state.location.search })
  const search = validateSearch(locationSearch)
  const mode = search.mode ?? defaultMode
  const region = search.region ?? board.region
  const navigate = Route.useNavigate()

  function changeRegion(picked: string) {
    const nextRegion = parseRegion(picked)

    if (!nextRegion) return

    rememberRegion(nextRegion)
    void navigate({ search: (previous) => ({ ...previous, region: nextRegion }), resetScroll: false })
  }

  function changeMode(nextMode: string) {
    void navigate({ search: (previous) => validateSearch({ ...previous, mode: nextMode }), resetScroll: false })
  }

  const filters = <HomeFilters mode={mode} region={region} onMode={changeMode} onRegion={changeRegion} />

  return (
    <div
      className={`divide-y divide-line/50 md:px-10 xl:px-0 ${wideLayout} [&>*]:py-8 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0`}
    >
      <HomeHero />
      <div data-search-dim className={halvesStyle}>
        <TopPlayers entries={board.entries} filters={filters} isLoading={isSlow} avatarCount={mode === '2v2' ? 2 : 1} />
        <TopGuilds guilds={guilds} />
      </div>
      <LegendsRow mostPlayed={mostPlayedLegends} />
      {patches && (
        <div data-search-dim>
          <PatchNews notes={patches} />
        </div>
      )}
    </div>
  )
}
