import { createFileRoute, notFound } from '@tanstack/react-router'
import { MatchView } from '../components/matches/MatchView'
import { NotFound } from '../components/NotFound'
import { getMatch } from '../server/replays'

export const Route = createFileRoute('/match/$id')({
  loader: async ({ params }) => {
    const match = await getMatch({ data: params.id }).catch(() => null)

    if (!match) throw notFound()

    return match
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.mapName ?? 'Match'} | BrawlTome` }] }),
  notFoundComponent: NotFound,
  component: MatchRoute,
})

function MatchRoute() {
  return <MatchView match={Route.useLoaderData()} />
}
