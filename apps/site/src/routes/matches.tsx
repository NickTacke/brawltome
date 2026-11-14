import { createFileRoute } from '@tanstack/react-router'
import { MatchesView } from '../components/matches/MatchesView'
import { getMatchesPage } from '../server/replays'

export const Route = createFileRoute('/matches')({
  loader: () => getMatchesPage(),
  head: () => ({ meta: [{ title: 'Matches | BrawlTome' }] }),
  // the page lists one visitor's uploads, so no cache may keep it
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: MatchesRoute,
})

function MatchesRoute() {
  return <MatchesView page={Route.useLoaderData()} />
}
