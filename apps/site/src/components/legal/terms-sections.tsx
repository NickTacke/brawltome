import { discordInviteUrl } from '../social-links'
import type { LegalSection } from './LegalPage'

const discordLink = <a href={discordInviteUrl}>our Discord</a>

export const termsSections: LegalSection[] = [
  {
    title: 'Not official',
    body: (
      <p>
        BrawlTome isn't associated with or endorsed by Blue Mammoth Games. They own Brawlhalla, its art and its
        trademarks, which appear here to show your stats.
      </p>
    ),
  },
  {
    title: 'The data',
    body: (
      <p>
        Statistics come from Brawlhalla's API and can be late, incomplete or wrong. Numbers we work out ourselves, like
        season history and averages, are estimates. Use them for fun, not for anything that depends on them being exact.
      </p>
    ),
  },
  {
    title: 'Using the site',
    body: (
      <>
        <p>Use BrawlTome however you like for yourself. Please don't:</p>
        <ul>
          <li>scrape it or call it automatically in bulk</li>
          <li>try to get around rate limits or bot checks</li>
          <li>use it to harass other players</li>
        </ul>
        <p>We may block access for anyone who does.</p>
      </>
    ),
  },
  {
    title: 'Your account',
    body: (
      <p>
        You sign in with Discord, so keeping that account safe is up to you. You can stop using BrawlTome at any time
        and ask us to delete your account on {discordLink}. Names you give your themes must not be offensive.
      </p>
    ),
  },
  {
    title: 'No guarantees',
    body: (
      <p>
        BrawlTome is a free hobby project. It's provided as it is, it may be down or change, and we're not liable for
        losses from using it, as far as the law allows.
      </p>
    ),
  },
  {
    title: 'Changes',
    body: (
      <p>If these terms change, the date at the top changes too. Using the site after that means you accept them.</p>
    ),
  },
]
