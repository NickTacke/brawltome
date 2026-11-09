import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { PlayerLookup } from '../components/lookup/PlayerLookup'
import { usePlayerLookup } from '../components/lookup/use-player-lookup'
import { PlayerPage as PlayerProfile } from '../components/player/PlayerPage'
import { usePlayerView } from '../components/player/use-player-view'
import { RefreshChallenge } from '../components/refresh/RefreshChallenge'
import { isPlayerRefreshed, isPlayerStale } from '../components/refresh/staleness'
import { useLiveRefresh } from '../components/refresh/use-live-refresh'
import { fixEncoding, parseEntityId } from '../lib'
import type { PlayerPage } from '../server/load-player'
import { getIsUnarmedExcluded, getPlayer, recordPlayerView, refreshPlayer } from '../server/players'

type LivePlayerProps = PlayerPage & { isUnarmedExcluded: boolean }

// a player the site has never stored is looked up from the browser, see usePlayerLookup
type PlayerRouteData = ({ kind: 'player' } & LivePlayerProps) | { kind: 'lookup'; playerId: number }

function pageTitle(playerName: string | undefined, status: string): string {
  if (playerName) return `${fixEncoding(playerName)} | BrawlTome`

  return status === 'error' ? 'Player unavailable | BrawlTome' : 'Player not found | BrawlTome'
}

// a lookup page says nothing yet, and crawlers reading random ids shouldn't index it
function pageMeta(data: PlayerRouteData | undefined, status: string) {
  if (data?.kind === 'lookup') {
    return [{ title: `Looking up player ${data.playerId} | BrawlTome` }, { name: 'robots', content: 'noindex' }]
  }

  return [{ title: pageTitle(data?.player.name, status) }]
}

export const Route = createFileRoute('/player/$id')({
  loader: async ({ params }): Promise<PlayerRouteData> => {
    const playerId = parseEntityId(params.id)

    if (playerId === null) throw notFound()

    const [page, isUnarmedExcluded] = await Promise.all([getPlayer({ data: playerId }), getIsUnarmedExcluded()])

    if (!page) return { kind: 'lookup', playerId }

    return { kind: 'player', ...page, isUnarmedExcluded }
  },
  head: ({ loaderData, match }) => ({ meta: pageMeta(loaderData, match.status) }),
  notFoundComponent: PlayerNotFound,
  errorComponent: PlayerLoadError,
  component: PlayerRoute,
})

function PlayerNotFound() {
  return (
    <div className="py-16">
      <h1 className="text-heading font-semibold">Player not found</h1>
      <p className="mt-2 text-soft">Check the player id, or search for the player by name.</p>
    </div>
  )
}

// a fixed message, the error itself is for the server log
function PlayerLoadError() {
  const { id } = Route.useParams()

  return (
    <div className="py-16">
      <h1 className="text-heading font-semibold">This player couldn't be loaded</h1>
      <p className="mt-2 text-soft">Something went wrong on our side. It's usually back in a moment.</p>
      <a
        href={`/player/${encodeURIComponent(id)}`}
        className="mt-4 inline-block text-primary underline underline-offset-4"
      >
        Try again
      </a>
    </div>
  )
}

const countView = (playerId: number) => recordPlayerView({ data: playerId })

function LivePlayer({ isUnarmedExcluded, ...page }: LivePlayerProps) {
  const playerId = page.player.brawlhallaId

  usePlayerView(playerId, countView)

  const live = useLiveRefresh({
    initial: page,
    isStale: (current) => isPlayerStale(current.player),
    isRefreshed: (baseline, current) => isPlayerRefreshed(baseline.player, current.player),
    load: () => getPlayer({ data: playerId }),
    refresh: (turnstileToken) => refreshPlayer({ data: { id: playerId, turnstileToken } }),
  })

  const refresh = { status: live.status, onRetry: live.retry }

  return (
    <>
      <PlayerProfile {...live.data} isUnarmedExcluded={isUnarmedExcluded} refresh={refresh} />
      <RefreshChallenge challenge={live.challenge} />
    </>
  )
}

// once the player is stored, the route loads again and shows the page as if it had always been there
function LookupPlayer({ playerId }: { playerId: number }) {
  const router = useRouter()

  const lookup = usePlayerLookup({
    load: () => getPlayer({ data: playerId }),
    lookUp: (turnstileToken) => refreshPlayer({ data: { id: playerId, turnstileToken } }),
    onFound: () => void router.invalidate(),
  })

  return (
    <>
      <PlayerLookup playerId={playerId} status={lookup.status} onRetry={lookup.retry} />
      <RefreshChallenge challenge={lookup.challenge} />
    </>
  )
}

function PlayerRoute() {
  const data = Route.useLoaderData()

  if (data.kind === 'lookup') return <LookupPlayer key={data.playerId} playerId={data.playerId} />

  const { kind: _kind, ...page } = data

  return <LivePlayer key={page.player.brawlhallaId} {...page} />
}
