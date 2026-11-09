import { createFileRoute } from '@tanstack/react-router'
import { ComingSoonPage } from '../components/coming-soon/ComingSoonPage'

export const Route = createFileRoute('/learn')({
  head: () => ({ meta: [{ title: 'Learn | BrawlTome' }] }),
  component: () => <ComingSoonPage slug="learn" />,
})
