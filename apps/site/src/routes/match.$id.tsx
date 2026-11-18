import { createFileRoute, notFound } from '@tanstack/react-router'
import { pageKindOf } from '../components/match/match-page-model'
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
  const match = Route.useLoaderData()

  // the review page replaces MatchView for stock matches in the next change; until then both kinds get MatchView
  if (pageKindOf(match) === 'review') return <MatchView match={match} />

  return <MatchView match={match} />
}
