import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/legal/LegalPage'
import { termsSections } from '../components/legal/terms-sections'

export const Route = createFileRoute('/terms')({
  head: () => ({ meta: [{ title: 'Terms | BrawlTome' }] }),
  component: TermsPage,
})

function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      updated="9 Nov 2026"
      intro={
        <p>
          The short version: BrawlTome is free, unofficial and offered as it is. Be fair to it and to other players.
        </p>
      }
      sections={termsSections}
    />
  )
}
