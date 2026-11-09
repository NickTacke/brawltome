import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonPage } from '../components/coming-soon/ComingSoonPage'

export const Route = createFileRoute('/stats')({
  head: () => ({ meta: [{ title: 'Statistics | BrawlTome' }] }),
  component: () => <ComingSoonPage slug="stats" />,
})
