import type { Sql } from '@brawltome/foundation'
import type { V0RankedSnapshot } from './ranked/source'
import { isUsablePlayerName } from './reference'

export type TeammateName = { brawlhallaId: number; playerName: string }

type NamedTeam = Pick<V0RankedSnapshot['fixedTeams'][number], 'brawlhallaIdOne' | 'brawlhallaIdTwo' | 'teamName'>
type TeamNameSource = Pick<V0RankedSnapshot, 'brawlhallaId' | 'name'> & { fixedTeams: readonly NamedTeam[] }

// a player has up to a few dozen teams; the cap keeps a refresh to one bounded write
export const maxTeammateNamesPerRefresh = 50

// V0 names a team "One+Two", in the order of brawlhalla_id_one and brawlhalla_id_two
function teammateNameIn(team: NamedTeam, ownerId: number, ownerName: string): TeammateName | null {
  const halves = team.teamName.split('+')

  // a name can contain "+", and then nothing says where one name ends
  if (halves.length !== 2) return null

  const isOwnerFirst = team.brawlhallaIdOne === ownerId
  const ownerHalf = halves[isOwnerFirst ? 0 : 1]
  const teammateHalf = halves[isOwnerFirst ? 1 : 0]

  // the same response names the owner: a team name that disagrees about them is not trusted about the teammate
  if (ownerHalf.trim() !== ownerName.trim()) return null

  const brawlhallaId = isOwnerFirst ? team.brawlhallaIdTwo : team.brawlhallaIdOne

  if (!isUsablePlayerName(teammateHalf, brawlhallaId)) return null

  return { brawlhallaId, playerName: teammateHalf }
}

export function readTeammateNames(snapshot: TeamNameSource): TeammateName[] {
  const ownerName = snapshot.name

  if (!ownerName) return []

  const names: TeammateName[] = []

  for (const team of snapshot.fixedTeams) {
    const name = teammateNameIn(team, snapshot.brawlhallaId, ownerName)

    if (name) names.push(name)

    if (names.length === maxTeammateNamesPerRefresh) break
  }

  return names
}

// Records the names a refreshed profile's team names give its teammates, for name verification to confirm. A team
// name is a hint and not a fact: about one in nine does not match the name V0 gives the teammate at the same time.
export async function recordTeammateNameSignals(
  sql: Sql,
  input: { profileBrawlhallaId: number; observedAt: Date; names: readonly TeammateName[] },
): Promise<{ recorded: number }> {
  if (input.names.length === 0) return { recorded: 0 }

  const brawlhallaIds = input.names.map(({ brawlhallaId }) => brawlhallaId)
  const playerNames = input.names.map(({ playerName }) => playerName)

  const recorded = await sql<{ brawlhalla_id: number }[]>`
    WITH input AS (
      SELECT DISTINCT ON (brawlhalla_id) brawlhalla_id, player_name
      FROM unnest(${brawlhallaIds}::integer[], ${playerNames}::text[]) AS input(brawlhalla_id, player_name)
      ORDER BY brawlhalla_id
    ),
    known_names AS (
      SELECT brawlhalla_id, player_name, last_success_at IS NOT NULL AS is_live
      FROM players.ranked_profiles
      WHERE brawlhalla_id = ANY(${brawlhallaIds}::integer[]) AND player_name IS NOT NULL
      UNION ALL
      SELECT brawlhalla_id, player_name, last_success_at IS NOT NULL AND snapshot_source <> 'legacy-v2'
      FROM players.career_profiles
      WHERE brawlhalla_id = ANY(${brawlhallaIds}::integer[]) AND player_name IS NOT NULL
      UNION ALL
      SELECT brawlhalla_id, display_alias, false
      FROM players.discovery_aliases
      WHERE brawlhalla_id = ANY(${brawlhallaIds}::integer[])
    ),
    unseen AS (
      SELECT input.brawlhalla_id, input.player_name
      FROM input
      JOIN known_names known USING (brawlhalla_id)
      GROUP BY input.brawlhalla_id, input.player_name
      -- verification compares with a live V0 name, and a name the teammate already had is not news
      HAVING bool_or(known.is_live)
        AND NOT bool_or(players.names_match(btrim(known.player_name), btrim(input.player_name)))
    )
    INSERT INTO players.teammate_name_signals AS current
      (brawlhalla_id, player_name, profile_brawlhalla_id, observed_at)
    -- ordered, so two refreshes that share teammates lock their rows in the same order
    SELECT brawlhalla_id, player_name, ${input.profileBrawlhallaId}, ${input.observedAt}
    FROM unseen ORDER BY brawlhalla_id
    ON CONFLICT (brawlhalla_id) DO UPDATE SET
      player_name = EXCLUDED.player_name,
      profile_brawlhalla_id = EXCLUDED.profile_brawlhalla_id,
      observed_at = EXCLUDED.observed_at
    -- the same name again must not look like a new observation, or every refresh would ask for another check
    WHERE current.observed_at < EXCLUDED.observed_at
      AND NOT players.names_match(current.player_name, EXCLUDED.player_name)
    RETURNING brawlhalla_id
  `

  return { recorded: recorded.length }
}
