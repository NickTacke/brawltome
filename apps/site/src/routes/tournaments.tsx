import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonPage } from '../components/coming-soon/ComingSoonPage'

export const Route = createFileRoute('/tournaments')({
  head: () => ({ meta: [{ title: 'Tournaments | BrawlTome' }] }),
  component: () => <ComingSoonPage slug="tournaments" />,
})
