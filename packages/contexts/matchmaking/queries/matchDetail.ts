import type { MatchEventRow, MatchPlayerRow, MatchRow } from '../match'
import type { MatchRepo } from '../match.repo'

export async function matchDetail(
  deps: { matchRepo: Pick<MatchRepo, 'findBySlug' | 'findPlayers' | 'findEvents'> },
  slug: string,
): Promise<{ match: MatchRow; players: MatchPlayerRow[]; events: MatchEventRow[] } | null> {
  const match = await deps.matchRepo.findBySlug(slug)
  if (!match) return null
  const [players, events] = await Promise.all([
    deps.matchRepo.findPlayers(slug),
    deps.matchRepo.findEvents(slug),
  ])
  return { match, players, events }
}
