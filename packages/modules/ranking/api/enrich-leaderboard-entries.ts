import type { LeaderboardIdentity } from '@brawltome/contracts'
import type { PlayerReference, PlayerReferenceQueries } from '@brawltome/player'

type FixedTeamIdentity = Extract<LeaderboardIdentity, { type: 'fixed-two-vs-two-team' }>
type Contestant = FixedTeamIdentity['players'][number]
type EnrichableEntry = { identity: LeaderboardIdentity }
type ReferenceById = ReadonlyMap<number, PlayerReference | null>

function contestantsOf(identity: LeaderboardIdentity): readonly Contestant[] {
  return identity.type === 'fixed-two-vs-two-team' ? identity.players : [identity.player]
}

async function readReferences(
  entries: readonly EnrichableEntry[],
  references: PlayerReferenceQueries,
): Promise<ReferenceById> {
  const contestants = entries.flatMap(({ identity }) => contestantsOf(identity))
  const brawlhallaIds = [...new Set(contestants.map(({ brawlhallaId }) => brawlhallaId))]

  const pairs = await Promise.all(
    brawlhallaIds.map(async (brawlhallaId) => [brawlhallaId, await references.byId(brawlhallaId)] as const),
  )

  return new Map(pairs)
}

function enrichContestant(contestant: Contestant, referenceById: ReferenceById): Contestant {
  const reference = referenceById.get(contestant.brawlhallaId)

  return {
    ...contestant,
    name: reference?.name ?? contestant.name,
    bestLegendNameKey: reference?.bestLegendNameKey ?? null,
  }
}

function enrichFixedTeam(identity: FixedTeamIdentity, referenceById: ReferenceById): FixedTeamIdentity {
  const [first, second] = identity.players
  const enrichedFirst = enrichContestant(first, referenceById)
  const enrichedSecond = enrichContestant(second, referenceById)

  // two local players on one account share a reference, so only the row's own names tell them apart
  if (first.brawlhallaId === second.brawlhallaId) {
    return {
      ...identity,
      players: [
        { ...enrichedFirst, name: first.name },
        { ...enrichedSecond, name: second.name },
      ],
    }
  }

  return { ...identity, players: [enrichedFirst, enrichedSecond] }
}

function enrichIdentity(identity: LeaderboardIdentity, referenceById: ReferenceById): LeaderboardIdentity {
  if (identity.type === 'fixed-two-vs-two-team') return enrichFixedTeam(identity, referenceById)

  return { ...identity, player: enrichContestant(identity.player, referenceById) }
}

/** Swaps the name each board row captured for the player's current one, and adds their best legend. */
export async function enrichLeaderboardEntries(
  entries: readonly EnrichableEntry[],
  references: PlayerReferenceQueries,
): Promise<EnrichableEntry[]> {
  const referenceById = await readReferences(entries, references)

  return entries.map((entry) => ({ ...entry, identity: enrichIdentity(entry.identity, referenceById) }))
}
