import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonPage } from '../components/coming-soon/ComingSoonPage'

export const Route = createFileRoute('/matches')({
  head: () => ({ meta: [{ title: 'Matches | BrawlTome' }] }),
  component: () => <ComingSoonPage slug="matches" />,
})
