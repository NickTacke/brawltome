import '@tanstack/react-start/server-only'
import { accountSessionSchema, replayAccessSchema } from '@brawltome/contracts'
import type { MatchesPage } from '../components/matches/matches-model'
import { accountLinks } from './account-links'
import { readApi } from './api'
import { loadMyReplays } from './replay-data'

/** The matches page for the visitor: sign in, link Steam, or upload and see their replays. */
export async function loadMatchesPage(sessionToken: string | undefined): Promise<MatchesPage> {
  const links = accountLinks(process.env.PUBLIC_API_URL)
  const headers = sessionToken ? { headers: { 'x-visitor-session': sessionToken } } : {}
  // until replays open to everyone, the page is still "coming soon" for all but the operators
  const access = await readApi('/replays/access', replayAccessSchema, 'load matches page', headers)

  if (!access.canSee) return { kind: 'comingSoon' }

  if (!sessionToken) return { kind: 'signedOut', signInUrl: links.signIn }

  const current = await readApi('/account', accountSessionSchema, 'load matches page', headers)

  if (current.status === 'anonymous') return { kind: 'signedOut', signInUrl: links.signIn }

  const replays = await loadMyReplays(sessionToken)

  return {
    kind: 'signedIn',
    // a verified player, or an operator, who may upload without one
    canUpload: access.canUpload,
    verifySteamUrl: links.verifySteam,
    replays,
  }
}
