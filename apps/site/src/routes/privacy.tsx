import { createFileRoute } from '@tanstack/react-router'
import { LegalPage } from '../components/legal/LegalPage'
import { privacySections } from '../components/legal/privacy-sections'

export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: 'Privacy | BrawlTome' }] }),
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="9 Nov 2026"
      intro={
        <p>
          BrawlTome is a fan-made statistics site for Brawlhalla. We keep as little about you as we can. This page says
          exactly what that is.
        </p>
      }
      sections={privacySections}
    />
  )
}
