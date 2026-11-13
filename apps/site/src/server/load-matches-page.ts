import '@tanstack/react-start/server-only'
import { accountSessionSchema, primaryPlayerVerificationStateSchema } from '@brawltome/contracts'
import type { MatchesPage } from '../components/matches/matches-model'
import { accountLinks } from './account-links'
import { readApi } from './api'
import { loadMyReplays } from './replay-data'

/** The matches page for the visitor: sign in, link Steam, or upload and see their replays. */
export async function loadMatchesPage(sessionToken: string | undefined): Promise<MatchesPage> {
  const links = accountLinks(process.env.PUBLIC_API_URL)

  if (!sessionToken) return { kind: 'signedOut', signInUrl: links.signIn }

  const headers = { headers: { 'x-visitor-session': sessionToken } }
  const current = await readApi('/account', accountSessionSchema, 'load matches page', headers)

  if (current.status === 'anonymous') return { kind: 'signedOut', signInUrl: links.signIn }

  const [verification, replays] = await Promise.all([
    readApi('/account/primary-player', primaryPlayerVerificationStateSchema, 'load matches page', headers),
    loadMyReplays(sessionToken),
  ])

  return {
    kind: 'signedIn',
    isVerified: verification.primaryPlayer !== null,
    verifySteamUrl: links.verifySteam,
    replays,
  }
}
