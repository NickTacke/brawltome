import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Privacy' }

const sections = [
  {
    title: 'What we measure',
    body: 'Which kinds of pages are visited (page types, not individual IDs), searches and whether they found a result, how fresh the data was, loading speed, errors, which features are used, and the domain of the website that referred you.',
  },
  {
    title: 'What we don’t do',
    body: 'No cookies or device storage for analytics. We never store your IP address or browser details. There is no tracking across sites or across days, no ads and no third-party trackers.',
  },
  {
    title: 'How we count visitors',
    body: 'We use a one-way hash of your IP address and browser details combined with a secret that is replaced every day and then discarded, so the hash can’t be turned back into your IP address or linked across days. We use it only to count unique visitors per day, and we never store your IP address or browser details. Each browser tab also gets a random visit ID held in memory (not on your device) to connect pages within one visit.',
  },
  {
    title: 'Opting out',
    body: 'If your browser sends Do Not Track or Global Privacy Control, measurement is turned off entirely.',
  },
  {
    title: 'Retention',
    body: 'The hash and visit ID are kept with the other measurement data for 30 days, then deleted.',
  },
  {
    title: 'Sign-in cookies',
    body: 'Signing in with Discord uses cookies for your login session. They are strictly necessary for signing in and are not used for analytics.',
  },
  {
    title: 'Preference cookies',
    body: 'The /queue page remembers your Queue view preference in a functional cookie. It is not used for analytics.',
  },
]

export default function PrivacyPage() {
  return (
    <main className="min-h-screen w-full max-w-3xl mx-auto p-4 pb-12">
      <h1 className="text-3xl font-bold mb-6">Privacy</h1>
      <div className="space-y-6">
        {sections.map(({ title, body }) => (
          <section key={title}>
            <h2 className="text-lg font-semibold mb-1">{title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
          </section>
        ))}
        <section>
          <h2 className="text-lg font-semibold mb-1">Contact</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Questions? Reach us on{' '}
            <a
              href="https://discord.gg/ft5CJyjkkS"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground transition-colors"
            >
              Discord
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
