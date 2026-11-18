import { createFileRoute, notFound } from '@tanstack/react-router'
import { MatchByKind } from '../components/match/MatchByKind'
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
  const match = Route.useLoaderData()

  return <MatchByKind match={match} />
}
