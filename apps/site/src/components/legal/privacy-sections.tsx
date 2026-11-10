import { discordInviteUrl } from '../social-links'
import type { LegalSection } from './LegalPage'

const discordLink = <a href={discordInviteUrl}>our Discord</a>

export const privacySections: LegalSection[] = [
  {
    title: 'Player statistics',
    body: (
      <>
        <p>
          Player and guild pages show data from Brawlhalla's public API: names, ranks, ratings, legends, weapons and
          guild membership. We store it to show history over time, like rating graphs and old names.
        </p>
        <p>
          If you want your player page removed, message us on {discordLink}. Because the data is public in the game, it
          may come back if the game reports it again.
        </p>
      </>
    ),
  },
  {
    title: 'Signing in',
    body: (
      <>
        <p>Signing in is optional. When you sign in with Discord we store:</p>
        <ul>
          <li>your Discord user ID, display name and avatar</li>
          <li>a login session, kept until you sign out or for up to 30 days</li>
          <li>the players you pin and your theme</li>
        </ul>
        <p>We never see your Discord password or email address.</p>
      </>
    ),
  },
  {
    title: 'Verifying your Brawlhalla account',
    body: (
      <p>
        If you verify your account through Steam, we store your Steam ID with each attempt, and the Brawlhalla player it
        belongs to, so we can mark that player as yours. We don't get access to your Steam account.
      </p>
    ),
  },
  {
    title: 'Measuring how the site is used',
    body: (
      <>
        <p>
          We count which kinds of pages are visited, searches and whether they found something, loading speed, errors,
          which features are used and which website sent you.
        </p>
        <p>
          To count unique visitors per day we use a one-way hash of your IP address (for IPv6, only the part that names
          your network) and browser details, mixed with a secret that is replaced every day and then thrown away. The
          hash can't be turned back into your IP address or linked across days. We never store your IP address or
          browser details. Each open tab gets a random visit ID that only lives in that tab's memory, so nothing is
          stored on your device for this.
        </p>
        <p>
          If your browser sends Do Not Track or Global Privacy Control, we don't measure anything. Measurement data is
          deleted after 30 days.
        </p>
      </>
    ),
  },
  {
    title: 'Cookies and browser storage',
    body: (
      <ul>
        <li>a login cookie, only when you're signed in</li>
        <li>your choice to include or exclude unarmed in weapon stats</li>
        <li>your theme, and any themes you make, in your browser's storage</li>
      </ul>
    ),
  },
  {
    title: 'Abuse protection',
    body: (
      <p>
        To stop people overloading the site, refresh buttons are limited per visitor using a hash of the IP address, and
        some actions use Cloudflare Turnstile to check for bots. Cloudflare sits in front of the site and handles your
        connection to it.
      </p>
    ),
  },
  {
    title: 'What we never do',
    body: <p>No ads, no selling data, no third-party trackers and no tracking across other websites.</p>,
  },
  {
    title: 'Your rights',
    body: (
      <p>
        You can ask to see the data we hold about you, have it corrected, or have your account and everything attached
        to it deleted. Message us on {discordLink} and we'll handle it.
      </p>
    ),
  },
]
