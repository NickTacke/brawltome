import '@tanstack/react-start/server-only'
import { accountSessionSchema, replayAccessSchema } from '@brawltome/contracts'
import type { MatchesPage } from '../components/matches/matches-model'
import { accountLinks } from './account-links'
import { readApi } from './api'
import { loadMyMatches, loadRecentMatches } from './match-lists'
import { loadMyReplays } from './replay-data'

/** The matches page for the visitor: everyone's latest matches, and their own once they're signed in. */
export async function loadMatchesPage(sessionToken: string | undefined): Promise<MatchesPage> {
  const links = accountLinks(process.env.PUBLIC_API_URL)
  const headers = sessionToken ? { headers: { 'x-visitor-session': sessionToken } } : {}
  // until replays open to everyone, the page is still "coming soon" for all but the operators
  const access = await readApi('/replays/access', replayAccessSchema, 'load matches page', headers)
  const loadedAt = new Date().toISOString()

  if (!access.canSee) return { kind: 'comingSoon' }

  const current = sessionToken ? await readApi('/account', accountSessionSchema, 'load matches page', headers) : null

  if (!sessionToken || current?.status !== 'signedIn') {
    const recent = await loadRecentMatches(sessionToken)

    return { kind: 'signedOut', signInUrl: links.signIn, recent, loadedAt }
  }

  const [replays, mine, recent] = await Promise.all([
    loadMyReplays(sessionToken),
    loadMyMatches(sessionToken),
    loadRecentMatches(sessionToken),
  ])

  return {
    kind: 'signedIn',
    // a verified player, or an operator, who may upload without one
    canUpload: access.canUpload,
    verifySteamUrl: links.verifySteam,
    replays,
    mine,
    recent,
    loadedAt,
  }
}
