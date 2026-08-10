import postgres from 'postgres'

type LegacyClan = {
  clan_id: number
  clan_name: string
  clan_create_date: Date
  clan_xp: string
  clan_lifetime_xp: string
  last_updated: Date
}
type LegacyMember = {
  clan_id: number
  brawlhalla_id: number
  name: string
  rank: string
  join_date: Date
  xp: number
  legend_name_key: string | null
}
type LegacyPlayerClan = {
  brawlhalla_id: number
  clan_name: string
  clan_id: number
  clan_xp: string
  clan_lifetime_xp: string
  personal_xp: number
}

export async function importLegacyClans(connectionString: string): Promise<{ imported: number; quarantined: number }> {
  const client = postgres(connectionString, { max: 1 })
  try {
    return await client.begin(async (transaction) => {
      const sql = transaction as unknown as typeof client
      const clans = await sql<LegacyClan[]>`
        SELECT clan_id, clan_name, clan_create_date, clan_xp::text, clan_lifetime_xp::text, last_updated
        FROM public.clan ORDER BY clan_id
      `
      const members = await sql<LegacyMember[]>`
        SELECT clan_id, brawlhalla_id, name, rank, join_date, xp, legend_name_key
        FROM public.clan_member ORDER BY clan_id, brawlhalla_id
      `
      const playerClans = await sql<LegacyPlayerClan[]>`
        SELECT brawlhalla_id, clan_name, clan_id, clan_xp::text, clan_lifetime_xp::text, personal_xp
        FROM public.player_clan ORDER BY brawlhalla_id
      `

      for (const clan of clans) {
        await sql`
          INSERT INTO clans.legacy_archive (source_table, source_key, raw_row)
          VALUES ('clan', ${String(clan.clan_id)}, ${sql.json(clan)}) ON CONFLICT DO NOTHING
        `
        await sql`INSERT INTO clans.clans (clan_id) VALUES (${clan.clan_id}) ON CONFLICT DO NOTHING`
        await sql`
          INSERT INTO clans.profiles
            (clan_id, clan_name, clan_create_date, clan_xp, clan_lifetime_xp)
          VALUES (${clan.clan_id}, ${clan.clan_name}, ${clan.clan_create_date}, ${clan.clan_xp},
                  ${clan.clan_lifetime_xp})
          ON CONFLICT DO NOTHING
        `
        const legacyProvenance = {
          source: 'legacy-import',
          outcome: 'legacy-unknown',
          legacyTimestamp: clan.last_updated.toISOString(),
        }
        await sql`
          INSERT INTO clans.profile_state
            (clan_id, checked_at, check_provenance, last_success_at, last_success_provenance)
          VALUES (${clan.clan_id}, ${clan.last_updated}, ${sql.json(legacyProvenance)}, NULL, NULL)
          ON CONFLICT DO NOTHING
        `
        await sql`
          INSERT INTO clans.roster_state
            (clan_id, checked_at, check_provenance, last_success_at, last_success_provenance)
          VALUES (${clan.clan_id}, NULL, ${sql.json(legacyProvenance)}, NULL, NULL)
          ON CONFLICT DO NOTHING
        `
      }

      const clanById = new Map(clans.map((row) => [row.clan_id, row]))
      const playerClanByPlayer = new Map(playerClans.map((row) => [row.brawlhalla_id, row]))
      const rosterByPlayer = new Map<number, LegacyMember[]>()
      for (const member of members) {
        const rows = rosterByPlayer.get(member.brawlhalla_id) ?? []
        rows.push(member)
        rosterByPlayer.set(member.brawlhalla_id, rows)
      }
      let quarantined = 0
      let imported = clans.length

      for (const member of members) {
        await sql`
          INSERT INTO clans.legacy_archive (source_table, source_key, raw_row)
          VALUES ('clan_member', ${`${member.clan_id}:${member.brawlhalla_id}`}, ${sql.json(member)})
          ON CONFLICT DO NOTHING
        `
        const playerClan = playerClanByPlayer.get(member.brawlhalla_id)
        const canonicalClan = clanById.get(member.clan_id)
        const playerClanFactsConflict =
          playerClan !== undefined &&
          canonicalClan !== undefined &&
          (playerClan.clan_name !== canonicalClan.clan_name ||
            playerClan.clan_xp !== canonicalClan.clan_xp ||
            playerClan.clan_lifetime_xp !== canonicalClan.clan_lifetime_xp)
        const duplicateRoster = (rosterByPlayer.get(member.brawlhalla_id)?.length ?? 0) > 1
        const conflicts =
          !canonicalClan ||
          duplicateRoster ||
          playerClanFactsConflict ||
          (playerClan !== undefined && (playerClan.clan_id !== member.clan_id || playerClan.personal_xp !== member.xp))
        if (conflicts) {
          quarantined++
          await sql`
            INSERT INTO clans.import_conflicts (conflict_key, conflict_kind, source_rows)
            VALUES (${`membership:${member.brawlhalla_id}`}, 'legacy-membership-disagreement',
                    ${sql.json({ clan: canonicalClan, roster: rosterByPlayer.get(member.brawlhalla_id), playerClan })})
            ON CONFLICT DO NOTHING
          `
          continue
        }
        await sql`
          INSERT INTO clans.members
            (clan_id, brawlhalla_id, name, rank, join_date, xp, guild_points, observed_at)
          VALUES (${member.clan_id}, ${member.brawlhalla_id}, ${member.name}, ${member.rank},
                  ${member.join_date}, ${String(member.xp)}, NULL, NULL)
          ON CONFLICT DO NOTHING
        `
        imported++
      }

      for (const row of playerClans) {
        await sql`
          INSERT INTO clans.legacy_archive (source_table, source_key, raw_row)
          VALUES ('player_clan', ${String(row.brawlhalla_id)}, ${sql.json(row)}) ON CONFLICT DO NOTHING
        `
        if (!rosterByPlayer.has(row.brawlhalla_id)) {
          quarantined++
          await sql`
            INSERT INTO clans.import_conflicts (conflict_key, conflict_kind, source_rows)
            VALUES (${`membership:${row.brawlhalla_id}`}, 'legacy-membership-missing-roster', ${sql.json({ playerClan: row })})
            ON CONFLICT DO NOTHING
          `
        }
      }
      return { imported, quarantined }
    })
  } finally {
    await client.end()
  }
}
