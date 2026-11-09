import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePlaceholder,
})

function HomePlaceholder() {
  return <h1 className="text-heading font-semibold">BrawlTome</h1>
}
