import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { processRefreshClan, processRefreshClanSection } from '../commands/refresh-clan'
import { clanMigrationInventory } from '../composition'
import { importLegacyClans } from '../legacy-import'
import { createPostgresClans } from '../postgres'

const baseUrl = process.env.DATABASE_URL
const databaseName = `brawltome_clans_${process.pid}_${randomUUID().replaceAll('-', '')}`
let admin: ReturnType<typeof postgres>
let connectionString = ''
let clans: ReturnType<typeof createPostgresClans>

const stats = (name = 'Canonical') => ({
  guild_id: 990070,
  name,
  create_date: 1660000000,
  xp: '900719925474099312345',
  legacy_xp: '900719925474099398765',
  notice: '',
  tags: [],
  discord_invite_code: '',
  guild_points: '900719925474099355555',
  is_recruiting: false,
})
const roster = (members: unknown[]) => ({ guild_id: 990070, guild_members: members })
const alpha = {
  brawlhalla_id: 1001,
  name: 'Alpha',
  rank: 'Leader',
  join_date: 1660100000,
  xp: '900719925474099388888',
  guild_points: '900719925474099377777',
}

beforeAll(async () => {
  if (!baseUrl) throw new Error('DATABASE_URL is required for Clans integration tests')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  admin = postgres(adminUrl.toString(), { max: 1 })
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
  const url = new URL(baseUrl)
  url.pathname = `/${databaseName}`
  connectionString = url.toString()
  const setup = postgres(connectionString, { max: 1 })
  for (const migration of clanMigrationInventory) await setup.unsafe(migration.sql)
  await setup.end()
  clans = createPostgresClans(connectionString)
})

afterAll(async () => {
  await clans?.close()
  await admin?.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await admin?.end()
})

describe('Clans PostgreSQL capability', () => {
  test('publishes independently and preserves exact decimal XP through partial failures', async () => {
    await processRefreshClan(
      {
        clans,
        source: { getGuildStatsV1: async () => stats(), getGuildMembersV1: async () => roster([alpha]) },
      },
      990070,
    )
    const first = await clans.getById(990070)
    expect(first?.clanXp).toBe('900719925474099312345')
    expect(first?.clanLifetimeXp).toBe('1801439850948198711110')
    expect(first?.members[0].xp).toBe('900719925474099388888')
    expect(await clans.getPlayerMembership(1001)).toMatchObject({
      clanId: 990070,
      clanName: 'Canonical',
      personalXp: '900719925474099388888',
    })
    const rosterSuccess = first?.roster?.lastSuccessAt

    const result = await processRefreshClan(
      {
        clans,
        source: {
          getGuildStatsV1: async () => stats('Updated'),
          getGuildMembersV1: async () => {
            throw new Error('timeout')
          },
        },
      },
      990070,
    )
    const partial = await clans.getById(990070)
    expect(result.map((section) => section.outcome).sort()).toEqual(['preserved', 'published'])
    expect(partial?.clanName).toBe('Updated')
    expect(partial?.members.map((member) => member.brawlhallaId)).toEqual([1001])
    expect(partial?.roster?.lastSuccessAt).toEqual(rosterSuccess)
    expect(partial?.roster?.lastSuccessProvenance).toEqual({
      source: 'v1-guild-members',
      outcome: 'success',
    })
    expect(partial?.roster?.checkProvenance).toEqual({
      source: 'v1-guild-members',
      outcome: 'ambiguous-failure',
    })
    expect(partial?.roster?.checkedAt?.getTime()).toBeGreaterThanOrEqual(rosterSuccess?.getTime() ?? 0)

    await processRefreshClan(
      {
        clans,
        source: {
          getGuildStatsV1: async () => {
            throw new Error('malformed profile')
          },
          getGuildMembersV1: async () => roster([alpha]),
        },
      },
      990070,
    )
    const inversePartial = await clans.getById(990070)
    expect(inversePartial?.clanName).toBe('Updated')
    expect(inversePartial?.profile.lastSuccessAt).toEqual(partial?.profile.lastSuccessAt)
    expect(inversePartial?.roster?.lastSuccessAt?.getTime()).toBeGreaterThanOrEqual(rosterSuccess?.getTime() ?? 0)
  })

  test('records admission-limited check provenance and preserves the successful snapshot', async () => {
    const before = await clans.getById(990070)
    const admissionError = Object.assign(new Error('source admission limited'), { retryAfterSeconds: 17 })
    await expect(
      processRefreshClanSection(
        clans,
        {
          getGuildStatsV1: async () => {
            throw admissionError
          },
          getGuildMembersV1: async () => null,
        },
        990070,
        'profile',
      ),
    ).rejects.toBe(admissionError)
    const after = await clans.getById(990070)
    expect(after?.profile.lastSuccessAt).toEqual(before?.profile.lastSuccessAt)
    expect(after?.profile.lastSuccessProvenance).toEqual(before?.profile.lastSuccessProvenance)
    expect(after?.profile.checkProvenance).toEqual({
      source: 'v1-guild-stats',
      outcome: 'admission-limited',
    })
  })

  test('raises the owner fence before source I/O and rejects an expired stale lease', async () => {
    const operationId = randomUUID()
    const staleEffect = {
      operationId,
      section: 'profile' as const,
      leaseToken: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }
    const currentEffect = { ...staleEffect, leaseToken: 2 }
    expect(await clans.prepareRefreshEffect(staleEffect)).toBe('execute')
    expect(await clans.prepareRefreshEffect(currentEffect)).toBe('execute')
    let staleSourceCalls = 0
    const stale = await processRefreshClanSection(
      clans,
      {
        getGuildStatsV1: async () => {
          staleSourceCalls++
          return stats('Stale Lease')
        },
        getGuildMembersV1: async () => null,
      },
      990070,
      'profile',
      'on-demand',
      new Date(),
      staleEffect,
    )
    expect(stale).toMatchObject({ outcome: 'preserved' })
    expect(staleSourceCalls).toBe(0)

    const current = await processRefreshClanSection(
      clans,
      { getGuildStatsV1: async () => stats('Current Lease'), getGuildMembersV1: async () => null },
      990070,
      'profile',
      'on-demand',
      new Date(),
      currentEffect,
    )
    expect(current.outcome).toBe('published')
    expect((await clans.getById(990070))?.clanName).toBe('Current Lease')
  })

  test('rejects an expired owner lease before any successor prepares', async () => {
    const effect = {
      operationId: randomUUID(),
      section: 'profile' as const,
      leaseToken: 1,
      leaseExpiresAt: new Date(Date.now() - 1_000),
    }
    expect(await clans.prepareRefreshEffect(effect)).toBe('fenced')
    let sourceCalls = 0
    const result = await processRefreshClanSection(
      clans,
      {
        getGuildStatsV1: async () => {
          sourceCalls++
          return stats('Expired Lease')
        },
        getGuildMembersV1: async () => null,
      },
      990070,
      'profile',
      'on-demand',
      new Date(),
      effect,
    )
    expect(result.outcome).toBe('preserved')
    expect(sourceCalls).toBe(0)
    expect((await clans.getById(990070))?.clanName).not.toBe('Expired Lease')
  })

  test('revoking mirrored authority during source I/O prevents publication', async () => {
    const effect = {
      operationId: randomUUID(),
      section: 'profile' as const,
      leaseToken: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    }
    let releaseSource!: () => void
    const sourceBlocked = new Promise<void>((resolve) => {
      releaseSource = resolve
    })
    const refresh = processRefreshClanSection(
      clans,
      {
        getGuildStatsV1: async () => {
          await sourceBlocked
          return stats('Revoked Lease')
        },
        getGuildMembersV1: async () => null,
      },
      990070,
      'profile',
      'on-demand',
      new Date(),
      effect,
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
    await clans.revokeRefreshEffect(effect)
    expect(
      await clans.prepareRefreshEffect({
        ...effect,
        leaseExpiresAt: new Date(effect.leaseExpiresAt.getTime() + 60_000),
      }),
    ).toBe('fenced')
    releaseSource()
    expect((await refresh).outcome).toBe('preserved')
    expect((await clans.getById(990070))?.clanName).not.toBe('Revoked Lease')
  })

  test('preserves newer failed-check metadata when an older successful observation arrives late', async () => {
    const clanId = 990074
    const successAt = new Date(Date.now() + 10_000)
    const failedCheckAt = new Date(successAt.getTime() + 10_000)
    const profile = (name: string) => ({ ...stats(name), guild_id: clanId })
    await processRefreshClanSection(
      clans,
      { getGuildStatsV1: async () => profile('Before Failure'), getGuildMembersV1: async () => roster([alpha]) },
      clanId,
      'profile',
      'background',
      successAt,
    )
    await processRefreshClanSection(
      clans,
      {
        getGuildStatsV1: async () => {
          throw new Error('later failure')
        },
        getGuildMembersV1: async () => null,
      },
      clanId,
      'profile',
      'background',
      failedCheckAt,
    )
    await processRefreshClanSection(
      clans,
      { getGuildStatsV1: async () => profile('Late Success'), getGuildMembersV1: async () => roster([alpha]) },
      clanId,
      'profile',
      'background',
      successAt,
    )
    const result = await clans.getById(clanId)
    expect(result?.clanName).toBe('Late Success')
    expect(result?.profile.lastSuccessAt).toEqual(successAt)
    expect(result?.profile.checkedAt).toEqual(failedCheckAt)
    expect(result?.profile.checkProvenance.outcome).toBe('ambiguous-failure')
    expect(result?.profile.lastSuccessProvenance?.outcome).toBe('success')
  })

  test('prevents older section and cross-clan membership observations from overwriting newer facts', async () => {
    const newer = new Date(Date.now() + 2_000)
    const older = new Date(Date.now() + 1_000)
    await processRefreshClanSection(
      clans,
      { getGuildStatsV1: async () => stats('Newer'), getGuildMembersV1: async () => null },
      990070,
      'profile',
      'background',
      newer,
    )
    await processRefreshClanSection(
      clans,
      { getGuildStatsV1: async () => stats('Older'), getGuildMembersV1: async () => null },
      990070,
      'profile',
      'background',
      older,
    )
    expect((await clans.getById(990070))?.clanName).toBe('Newer')

    await clans.publishProfile(
      {
        clanId: 990071,
        clanName: 'Other Clan',
        clanCreateDate: newer,
        clanXp: '1',
        clanLifetimeXp: '1',
        notice: '',
        tags: [],
        discordInviteCode: '',
        guildPoints: '0',
        isRecruiting: false,
      },
      newer,
      { source: 'v1-guild-stats', outcome: 'success' },
    )
    const member = {
      brawlhallaId: 2001,
      name: alpha.name,
      rank: alpha.rank,
      joinDate: new Date(alpha.join_date * 1_000),
      xp: alpha.xp,
      guildPoints: alpha.guild_points,
    }
    await clans.publishRoster(990071, [member], newer, { source: 'v1-guild-members', outcome: 'success' })
    await clans.publishRoster(990073, [member], older, { source: 'v1-guild-members', outcome: 'success' })
    expect(await clans.getPlayerMembership(2001)).toMatchObject({ clanId: 990071 })
  })

  test('persists the exact 41-digit sum of maximum 40-digit source XP operands', async () => {
    const maximum = '9999999999999999999999999999999999999999'
    const result = await processRefreshClanSection(
      clans,
      {
        getGuildStatsV1: async () => ({ ...stats('Maximum'), guild_id: 990072, xp: maximum, legacy_xp: maximum }),
        getGuildMembersV1: async () => null,
      },
      990072,
      'profile',
    )
    expect(result.outcome).toBe('published')
    expect((await clans.getById(990072))?.clanLifetimeXp).toBe('19999999999999999999999999999999999999998')
  })

  test('only a complete validated empty roster clears membership', async () => {
    const failures: Array<() => Promise<unknown | null>> = [
      async () => null,
      async () => {
        throw new Error('429 rate limited')
      },
      async () => ({ guild_id: 990070 }),
      async () => ({ guild_id: 990071, guild_members: [] }),
    ]
    const successAt = (await clans.getById(990070))?.roster?.lastSuccessAt
    for (const getGuildMembersV1 of failures) {
      await processRefreshClan({ clans, source: { getGuildStatsV1: async () => null, getGuildMembersV1 } }, 990070)
      const preserved = await clans.getById(990070)
      expect(preserved?.members).toHaveLength(1)
      expect(preserved?.roster?.lastSuccessAt).toEqual(successAt)
    }

    await processRefreshClan(
      { clans, source: { getGuildStatsV1: async () => null, getGuildMembersV1: async () => roster([]) } },
      990070,
    )
    expect((await clans.getById(990070))?.members).toHaveLength(0)
  })

  test('legacy import is idempotent and quarantines disagreement without precedence', async () => {
    const setup = postgres(connectionString, { max: 1 })
    await setup.unsafe(`
      CREATE TABLE public.clan (clan_id integer PRIMARY KEY, clan_name text NOT NULL, clan_create_date timestamp NOT NULL,
        clan_xp bigint NOT NULL, clan_lifetime_xp bigint NOT NULL, last_updated timestamp NOT NULL);
      CREATE TABLE public.clan_member (clan_id integer NOT NULL, brawlhalla_id integer NOT NULL, name text NOT NULL,
        rank text NOT NULL, join_date timestamp NOT NULL, xp integer NOT NULL, legend_name_key text,
        PRIMARY KEY (clan_id, brawlhalla_id));
      CREATE TABLE public.player_clan (brawlhalla_id integer PRIMARY KEY, clan_name text NOT NULL, clan_id integer NOT NULL,
        clan_xp bigint NOT NULL, clan_lifetime_xp bigint NOT NULL, personal_xp integer NOT NULL);
      INSERT INTO public.clan VALUES (77, 'Legacy', now(), 10, 20, now()), (78, 'Other', now(), 30, 40, now());
      INSERT INTO public.clan_member VALUES
        (77, 55, 'Member', 'Member', now(), 9, NULL),
        (999, 56, 'Orphan', 'Member', now(), 1, NULL);
      INSERT INTO public.player_clan VALUES (55, 'Other', 78, 30, 40, 9);
    `)
    await setup.end()
    const completed = await importLegacyClans(connectionString)
    expect(completed.status).toBe('complete')
    expect(completed.reconciliation.rejectedRows).toBe(3)
    expect(await importLegacyClans(connectionString)).toEqual(completed)
    const inspect = postgres(connectionString)
    const [{ member_count }] =
      await inspect`SELECT count(*)::integer AS member_count FROM clans.members WHERE brawlhalla_id = 55`
    const [{ rejected_count }] =
      await inspect`SELECT count(*)::integer AS rejected_count FROM clans.legacy_import_rejections`
    const [{ archive_count }] = await inspect`SELECT count(*)::integer AS archive_count FROM clans.legacy_archive`
    expect({ member_count, rejected_count, archive_count }).toEqual({
      member_count: 0,
      rejected_count: 3,
      archive_count: 5,
    })
    await inspect.end()
  })
})
