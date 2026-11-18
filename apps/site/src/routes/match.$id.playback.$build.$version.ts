import { createFileRoute } from '@tanstack/react-router'
import { servePlaybackTimeline } from '../server/replay-data'
import { currentSession } from '../server/session-cookie'

// like the replay file, the timeline goes through the site so the visitor's session decides who may see it
export const Route = createFileRoute('/match/$id/playback/$build/$version')({
  server: {
    handlers: {
      GET: ({ params }) => servePlaybackTimeline(params.id, params.build, params.version, currentSession().token),
    },
  },
})
