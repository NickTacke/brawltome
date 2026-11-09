import { createFileRoute } from '@tanstack/react-router'
import { getGuild } from '../server/guilds'

export const Route = createFileRoute('/guild/$id')({
  loader: ({ params }) => getGuild({ data: Number(params.id) }),
  component: GuildPlaceholder,
})

function GuildPlaceholder() {
  const guild = Route.useLoaderData()

  return <h1 className="text-heading font-semibold">{guild?.name ?? 'Guild not found'}</h1>
}
