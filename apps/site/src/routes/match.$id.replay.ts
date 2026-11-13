import { createFileRoute } from '@tanstack/react-router'
import { serveReplayFile } from '../server/replay-data'

// the replay file goes through the site, so the browser never talks to the api directly
export const Route = createFileRoute('/match/$id/replay')({
  server: { handlers: { GET: ({ params }) => serveReplayFile(params.id) } },
})
