import postgres from 'postgres'

export type ClanRefreshEffect = {
  operationId: string
  section: 'profile' | 'roster'
  leaseToken: number
  leaseExpiresAt: Date
}

export type ClanProvenance = {
  source: 'v1-guild-stats' | 'v1-guild-members' | 'legacy-import'
  outcome: 'success' | 'ambiguous-failure' | 'admission-limited' | 'source-rate-limited' | 'legacy-unknown'
  legacyTimestamp?: string
}

export type ClanProfileWrite = {
  clanId: number
  clanName: string
  clanCreateDate: Date
  clanXp: string
  clanLifetimeXp: string
  notice: string
  tags: string[]
  discordInviteCode: string
  guildPoints: string
  isRecruiting: boolean
}

export type ClanMemberWrite = {
  brawlhallaId: number
  name: string
  rank: string
  joinDate: Date
  xp: string
  guildPoints: string
}

export type ClanPublicationResult = 'applied' | 'already-applied' | 'fenced' | 'superseded'
export type ClanEffectPreparation = 'execute' | 'already-applied' | 'fenced'

type ProfileRow = {
  clan_id: number
  clan_name: string
  clan_create_date: Date
  clan_xp: string
  clan_lifetime_xp: string
  notice: string | null
  tags: string[] | null
  discord_invite_code: string | null
  guild_points: string | null
  is_recruiting: boolean | null
  checked_at: Date
  check_provenance: ClanProvenance
  last_success_at: Date | null
  last_success_provenance: ClanProvenance | null
}

type RosterStateRow = {
  checked_at: Date | null
  check_provenance: ClanProvenance
  last_success_at: Date | null
  last_success_provenance: ClanProvenance | null
}

type MemberRow = {
  brawlhalla_id: number
  name: string
  rank: string
  join_date: Date
  xp: string
  guild_points: string | null
}

export function createPostgresClans(connectionString: string) {
  const client = postgres(connectionString)
  const ensureIdentity = async (sql: typeof client, clanId: number) => {
    await sql`INSERT INTO clans.clans (clan_id) VALUES (${clanId}) ON CONFLICT DO NOTHING`
  }
  const effectState = async (sql: typeof client, effect?: ClanRefreshEffect) => {
    if (!effect) return 'execute' as const
    const [state] = await sql<{ lease_token: string | number; applied_at: Date | null; active: boolean }[]>`
      SELECT lease_token, applied_at,
             revoked_at IS NULL AND lease_expires_at > clock_timestamp() AS active
      FROM clans.refresh_effects
      WHERE operation_id = ${effect.operationId} AND section = ${effect.section}
      FOR UPDATE
    `
    if (!state || Number(state.lease_token) !== effect.leaseToken || !state.active) return 'fenced' as const
    return state.applied_at ? ('already-applied' as const) : ('execute' as const)
  }
  const markEffectApplied = async (sql: typeof client, effect?: ClanRefreshEffect) => {
    if (!effect) return true
    const applied = await sql<{ operation_id: string }[]>`
      UPDATE clans.refresh_effects SET applied_at = clock_timestamp()
      WHERE operation_id = ${effect.operationId} AND section = ${effect.section}
        AND lease_token = ${effect.leaseToken} AND applied_at IS NULL
        AND revoked_at IS NULL AND lease_expires_at > clock_timestamp()
      RETURNING operation_id
    `
    return applied.length === 1
  }
  const requireEffectApplied = async (sql: typeof client, effect?: ClanRefreshEffect) => {
    if (!(await markEffectApplied(sql, effect))) throw new Error('Clan refresh lease expired before publication')
  }

  return {
    async prepareRefreshEffect(effect: ClanRefreshEffect): Promise<ClanEffectPreparation> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const prepared = await sql<{ lease_token: string | number; applied_at: Date | null; active: boolean }[]>`
          INSERT INTO clans.refresh_effects (operation_id, section, lease_token, lease_expires_at)
          VALUES (${effect.operationId}, ${effect.section}, ${effect.leaseToken}, ${effect.leaseExpiresAt})
          ON CONFLICT (operation_id, section) DO UPDATE
          SET lease_token = EXCLUDED.lease_token, lease_expires_at = EXCLUDED.lease_expires_at,
              prepared_at = clock_timestamp(),
              revoked_at = CASE
                WHEN clans.refresh_effects.lease_token < EXCLUDED.lease_token THEN NULL
                ELSE clans.refresh_effects.revoked_at
              END,
              applied_at = CASE
                WHEN clans.refresh_effects.lease_token < EXCLUDED.lease_token THEN NULL
                ELSE clans.refresh_effects.applied_at
              END
          WHERE clans.refresh_effects.lease_token < EXCLUDED.lease_token
             OR (clans.refresh_effects.lease_token = EXCLUDED.lease_token
                 AND clans.refresh_effects.revoked_at IS NULL
                 AND clans.refresh_effects.applied_at IS NULL
                 AND clans.refresh_effects.lease_expires_at < EXCLUDED.lease_expires_at)
          RETURNING lease_token, applied_at,
                    revoked_at IS NULL AND lease_expires_at > clock_timestamp() AS active
        `
        if (prepared[0]) {
          if (!prepared[0].active) return 'fenced'
          return prepared[0].applied_at ? 'already-applied' : 'execute'
        }
        const [existing] = await sql<{ lease_token: string | number; applied_at: Date | null; active: boolean }[]>`
          SELECT lease_token, applied_at,
                 revoked_at IS NULL AND lease_expires_at > clock_timestamp() AS active
          FROM clans.refresh_effects
          WHERE operation_id = ${effect.operationId} AND section = ${effect.section}
          FOR UPDATE
        `
        if (Number(existing.lease_token) > effect.leaseToken || !existing.active) return 'fenced'
        return existing.applied_at ? 'already-applied' : 'execute'
      })
    },

    async revokeRefreshEffect(effect: ClanRefreshEffect): Promise<void> {
      await client`
        UPDATE clans.refresh_effects
        SET lease_expires_at = LEAST(lease_expires_at, clock_timestamp()),
            revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE operation_id = ${effect.operationId} AND section = ${effect.section}
          AND lease_token = ${effect.leaseToken} AND applied_at IS NULL
      `
    },

    async getById(clanId: number) {
      const [profile] = await client<ProfileRow[]>`
        SELECT profile.clan_id, profile.clan_name, profile.clan_create_date,
               profile.clan_xp::text, profile.clan_lifetime_xp::text,
               profile.notice, profile.tags, profile.discord_invite_code,
               profile.guild_points::text, profile.is_recruiting,
               state.checked_at, state.check_provenance,
               state.last_success_at, state.last_success_provenance
        FROM clans.profiles profile
        JOIN clans.profile_state state ON state.clan_id = profile.clan_id
        WHERE profile.clan_id = ${clanId}
      `
      if (!profile) return null
      const [roster] = await client<RosterStateRow[]>`
        SELECT checked_at, check_provenance, last_success_at, last_success_provenance
        FROM clans.roster_state WHERE clan_id = ${clanId}
      `
      const members = await client<MemberRow[]>`
        SELECT brawlhalla_id, name, rank, join_date, xp::text, guild_points::text
        FROM clans.members WHERE clan_id = ${clanId}
        ORDER BY xp DESC, brawlhalla_id
      `
      return {
        clanId: profile.clan_id,
        clanName: profile.clan_name,
        clanCreateDate: profile.clan_create_date,
        clanXp: profile.clan_xp,
        clanLifetimeXp: profile.clan_lifetime_xp,
        notice: profile.notice,
        tags: profile.tags,
        discordInviteCode: profile.discord_invite_code,
        guildPoints: profile.guild_points,
        isRecruiting: profile.is_recruiting,
        profile: {
          checkedAt: profile.checked_at,
          checkProvenance: profile.check_provenance,
          lastSuccessAt: profile.last_success_at,
          lastSuccessProvenance: profile.last_success_provenance,
        },
        roster: roster
          ? {
              checkedAt: roster.checked_at,
              checkProvenance: roster.check_provenance,
              lastSuccessAt: roster.last_success_at,
              lastSuccessProvenance: roster.last_success_provenance,
            }
          : null,
        members: members.map((member) => ({
          brawlhallaId: member.brawlhalla_id,
          name: member.name,
          rank: member.rank,
          joinDate: member.join_date,
          xp: member.xp,
          guildPoints: member.guild_points,
        })),
      }
    },

    async getPlayerMembership(brawlhallaId: number) {
      const [membership] = await client<
        {
          clan_id: number
          clan_name: string
          clan_xp: string
          clan_lifetime_xp: string
          personal_xp: string
        }[]
      >`
        SELECT member.clan_id, profile.clan_name, profile.clan_xp::text,
               profile.clan_lifetime_xp::text, member.xp::text AS personal_xp
        FROM clans.members member
        JOIN clans.profiles profile ON profile.clan_id = member.clan_id
        WHERE member.brawlhalla_id = ${brawlhallaId}
      `
      return membership
        ? {
            clanId: membership.clan_id,
            clanName: membership.clan_name,
            clanXp: membership.clan_xp,
            clanLifetimeXp: membership.clan_lifetime_xp,
            personalXp: membership.personal_xp,
          }
        : null
    },

    async publishProfile(
      profile: ClanProfileWrite,
      checkedAt: Date,
      provenance: ClanProvenance,
      effect?: ClanRefreshEffect,
    ): Promise<ClanPublicationResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const effectResult = await effectState(sql, effect)
        if (effectResult !== 'execute') return effectResult
        await ensureIdentity(sql, profile.clanId)
        const [state] = await sql<{ last_success_at: Date | null }[]>`
          SELECT last_success_at FROM clans.profile_state WHERE clan_id = ${profile.clanId} FOR UPDATE
        `
        if (state?.last_success_at && state.last_success_at > checkedAt) {
          await requireEffectApplied(sql, effect)
          return 'superseded'
        }
        await sql`
          INSERT INTO clans.profiles
            (clan_id, clan_name, clan_create_date, clan_xp, clan_lifetime_xp, notice, tags,
             discord_invite_code, guild_points, is_recruiting)
          VALUES
            (${profile.clanId}, ${profile.clanName}, ${profile.clanCreateDate}, ${profile.clanXp},
             ${profile.clanLifetimeXp}, ${profile.notice}, ${sql.json(profile.tags)},
             ${profile.discordInviteCode}, ${profile.guildPoints}, ${profile.isRecruiting})
          ON CONFLICT (clan_id) DO UPDATE SET
            clan_name = EXCLUDED.clan_name, clan_create_date = EXCLUDED.clan_create_date,
            clan_xp = EXCLUDED.clan_xp, clan_lifetime_xp = EXCLUDED.clan_lifetime_xp,
            notice = EXCLUDED.notice, tags = EXCLUDED.tags,
            discord_invite_code = EXCLUDED.discord_invite_code, guild_points = EXCLUDED.guild_points,
            is_recruiting = EXCLUDED.is_recruiting
        `
        await sql`
          INSERT INTO clans.profile_state
            (clan_id, checked_at, check_provenance, last_success_at, last_success_provenance)
          VALUES (${profile.clanId}, ${checkedAt}, ${sql.json(provenance)}, ${checkedAt}, ${sql.json(provenance)})
          ON CONFLICT (clan_id) DO UPDATE SET
            checked_at = GREATEST(clans.profile_state.checked_at, EXCLUDED.checked_at),
            check_provenance = CASE
              WHEN clans.profile_state.checked_at <= EXCLUDED.checked_at THEN EXCLUDED.check_provenance
              ELSE clans.profile_state.check_provenance
            END,
            last_success_at = EXCLUDED.last_success_at,
            last_success_provenance = EXCLUDED.last_success_provenance
        `
        await requireEffectApplied(sql, effect)
        return 'applied'
      })
    },

    async recordProfileCheck(clanId: number, checkedAt: Date, provenance: ClanProvenance, effect?: ClanRefreshEffect) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        if ((await effectState(sql, effect)) !== 'execute') return false
        await ensureIdentity(sql, clanId)
        await sql`
          INSERT INTO clans.profile_state (clan_id, checked_at, check_provenance)
          VALUES (${clanId}, ${checkedAt}, ${sql.json(provenance)})
          ON CONFLICT (clan_id) DO UPDATE SET
            checked_at = EXCLUDED.checked_at, check_provenance = EXCLUDED.check_provenance
          WHERE clans.profile_state.checked_at <= EXCLUDED.checked_at
        `
        return true
      })
    },

    async publishRoster(
      clanId: number,
      members: ClanMemberWrite[],
      checkedAt: Date,
      provenance: ClanProvenance,
      effect?: ClanRefreshEffect,
    ): Promise<ClanPublicationResult> {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        const effectResult = await effectState(sql, effect)
        if (effectResult !== 'execute') return effectResult
        await ensureIdentity(sql, clanId)
        const [state] = await sql<{ last_success_at: Date | null }[]>`
          SELECT last_success_at FROM clans.roster_state WHERE clan_id = ${clanId} FOR UPDATE
        `
        if (state?.last_success_at && state.last_success_at > checkedAt) {
          await requireEffectApplied(sql, effect)
          return 'superseded'
        }
        const memberIds = members.map(({ brawlhallaId }) => brawlhallaId)
        if (memberIds.length === 0) {
          await sql`
            DELETE FROM clans.members
            WHERE clan_id = ${clanId} AND (observed_at IS NULL OR observed_at <= ${checkedAt})
          `
        } else {
          await sql`
            DELETE FROM clans.members
            WHERE clan_id = ${clanId} AND brawlhalla_id NOT IN ${sql(memberIds)}
              AND (observed_at IS NULL OR observed_at <= ${checkedAt})
          `
          for (const member of members) {
            await sql`
              INSERT INTO clans.members
                (clan_id, brawlhalla_id, name, rank, join_date, xp, guild_points, observed_at)
              VALUES (${clanId}, ${member.brawlhallaId}, ${member.name}, ${member.rank}, ${member.joinDate},
                      ${member.xp}, ${member.guildPoints}, ${checkedAt})
              ON CONFLICT (brawlhalla_id) DO UPDATE SET
                clan_id = EXCLUDED.clan_id, name = EXCLUDED.name, rank = EXCLUDED.rank,
                join_date = EXCLUDED.join_date, xp = EXCLUDED.xp,
                guild_points = EXCLUDED.guild_points, observed_at = EXCLUDED.observed_at
              WHERE clans.members.observed_at IS NULL OR clans.members.observed_at <= EXCLUDED.observed_at
            `
          }
        }
        await sql`
          INSERT INTO clans.roster_state
            (clan_id, checked_at, check_provenance, last_success_at, last_success_provenance)
          VALUES (${clanId}, ${checkedAt}, ${sql.json(provenance)}, ${checkedAt}, ${sql.json(provenance)})
          ON CONFLICT (clan_id) DO UPDATE SET
            checked_at = GREATEST(clans.roster_state.checked_at, EXCLUDED.checked_at),
            check_provenance = CASE
              WHEN clans.roster_state.checked_at IS NULL
                OR clans.roster_state.checked_at <= EXCLUDED.checked_at THEN EXCLUDED.check_provenance
              ELSE clans.roster_state.check_provenance
            END,
            last_success_at = EXCLUDED.last_success_at,
            last_success_provenance = EXCLUDED.last_success_provenance
        `
        await requireEffectApplied(sql, effect)
        return 'applied'
      })
    },

    async recordRosterCheck(clanId: number, checkedAt: Date, provenance: ClanProvenance, effect?: ClanRefreshEffect) {
      return client.begin(async (transaction) => {
        const sql = transaction as unknown as typeof client
        if ((await effectState(sql, effect)) !== 'execute') return false
        await ensureIdentity(sql, clanId)
        await sql`
          INSERT INTO clans.roster_state (clan_id, checked_at, check_provenance)
          VALUES (${clanId}, ${checkedAt}, ${sql.json(provenance)})
          ON CONFLICT (clan_id) DO UPDATE SET
            checked_at = EXCLUDED.checked_at, check_provenance = EXCLUDED.check_provenance
          WHERE clans.roster_state.checked_at IS NULL OR clans.roster_state.checked_at <= EXCLUDED.checked_at
        `
        return true
      })
    },

    async close() {
      await client.end()
    },
  }
}

export type PostgresClans = ReturnType<typeof createPostgresClans>
export type ClanQueries = Pick<PostgresClans, 'getById' | 'getPlayerMembership'>
