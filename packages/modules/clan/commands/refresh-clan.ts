import type { ClanMemberWrite, ClanProfileWrite, ClanRefreshEffect, PostgresClans } from '../postgres'

type SourceCallOptions = { caller: 'on-demand' | 'background' }
export interface ClanSource {
  getGuildStatsV1(clanId: number, options: SourceCallOptions): Promise<unknown | null>
  getGuildMembersV1(clanId: number, options: SourceCallOptions): Promise<unknown | null>
}

export type ClanRefreshSection = 'profile' | 'roster'
export type ClanRefreshResult = { section: ClanRefreshSection; outcome: 'published' | 'preserved'; error?: string }

type RecordValue = Record<string, unknown>
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const hasVisibleText = (value: string) => /[^\p{Separator}\p{Format}]/u.test(value)

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return value as number
}

function text(value: unknown, field: string, maximum?: number, requireVisible = false): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  if (maximum !== undefined && [...value].length > maximum) throw new Error(`${field} is too long`)
  if (requireVisible && !hasVisibleText(value)) throw new Error(`${field} must be visible`)
  return value
}

function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value == null) return null
  const parsed = text(value, field, maximum)
  return hasVisibleText(parsed) ? parsed : null
}

function sourceDate(value: unknown, field: string): Date {
  const date = new Date(integer(value, field) * 1_000)
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is outside the supported date range`)
  return date
}

function optionalSourceDate(value: unknown, field: string): Date | null {
  return value == null ? null : sourceDate(value, field)
}

function decimal(value: unknown, field: string): string {
  if (typeof value === 'string' && /^(0|[1-9]\d{0,39})$/.test(value)) return value
  if (Number.isSafeInteger(value) && (value as number) >= 0) return String(value)
  throw new Error(`${field} must be an exact non-negative decimal integer`)
}

function optionalDecimal(value: unknown, field: string): string | null {
  return value == null ? null : decimal(value, field)
}

function profile(payload: unknown, clanId: number): ClanProfileWrite {
  if (!isRecord(payload) || payload.guild_id !== clanId) {
    throw new Error('guild stats payload has an unexpected guild ID')
  }
  if (!Array.isArray(payload.tags) || !payload.tags.every((tag) => typeof tag === 'string')) {
    throw new Error('guild stats tags must be a complete string array')
  }
  if (typeof payload.is_recruiting !== 'boolean') throw new Error('guild stats is_recruiting must be boolean')
  const currentXp = decimal(payload.xp, 'guild stats xp')
  const legacyXp = decimal(payload.legacy_xp, 'guild stats legacy_xp')
  return {
    clanId,
    clanName: text(payload.name, 'guild stats name', 256, true),
    clanCreateDate: sourceDate(payload.create_date, 'guild stats create_date'),
    clanXp: currentXp,
    clanLifetimeXp: (BigInt(currentXp) + BigInt(legacyXp)).toString(),
    notice: text(payload.notice, 'guild stats notice'),
    tags: payload.tags as string[],
    discordInviteCode: text(payload.discord_invite_code, 'guild stats discord_invite_code'),
    guildPoints: decimal(payload.guild_points, 'guild stats guild_points'),
    isRecruiting: payload.is_recruiting,
  }
}

function roster(payload: unknown, clanId: number): ClanMemberWrite[] {
  if (!isRecord(payload) || payload.guild_id !== clanId) {
    throw new Error('guild members payload has an unexpected guild ID')
  }
  if (!Array.isArray(payload.guild_members)) throw new Error('guild_members must be a complete array')
  const ids = new Set<number>()
  return payload.guild_members.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`guild member ${index} must be an object`)
    const brawlhallaId = integer(raw.brawlhalla_id, `guild member ${index} brawlhalla_id`)
    if (brawlhallaId === 0 || ids.has(brawlhallaId)) {
      throw new Error('guild roster contains an invalid duplicate player ID')
    }
    ids.add(brawlhallaId)
    return {
      brawlhallaId,
      name: optionalText(raw.name, `guild member ${index} name`, 256),
      rank: optionalText(raw.rank, `guild member ${index} rank`, 64),
      joinDate: optionalSourceDate(raw.join_date, `guild member ${index} join_date`),
      xp: decimal(raw.xp, `guild member ${index} xp`),
      guildPoints: optionalDecimal(raw.guild_points, `guild member ${index} guild_points`),
    }
  })
}

function retryMetadata(error: unknown): { outcome: 'admission-limited' | 'source-rate-limited' } | null {
  if (!isRecord(error)) return null
  if (Number.isFinite(error.retryAfterSeconds)) return { outcome: 'admission-limited' }
  if (Number.isFinite(error.retryAfterMs)) return { outcome: 'source-rate-limited' }
  return null
}

export async function processRefreshClanSection(
  clans: PostgresClans,
  source: ClanSource,
  clanId: number,
  section: ClanRefreshSection,
  caller: 'on-demand' | 'background' = 'background',
  checkedAt = new Date(),
  effect?: ClanRefreshEffect,
): Promise<ClanRefreshResult> {
  if (effect) {
    const preparation = await clans.prepareRefreshEffect(effect)
    if (preparation === 'already-applied') return { section, outcome: 'published' }
    if (preparation === 'fenced') return { section, outcome: 'preserved', error: `${section} effect was fenced` }
  }

  try {
    const publication =
      section === 'profile'
        ? await (async () => {
            const payload = await source.getGuildStatsV1(clanId, { caller })
            if (payload === null) throw new Error('ambiguous guild stats 404')
            return clans.publishProfile(
              profile(payload, clanId),
              checkedAt,
              { source: 'v1-guild-stats', outcome: 'success' },
              effect,
            )
          })()
        : await (async () => {
            const payload = await source.getGuildMembersV1(clanId, { caller })
            if (payload === null) throw new Error('ambiguous guild members 404')
            return clans.publishRoster(
              clanId,
              roster(payload, clanId),
              checkedAt,
              { source: 'v1-guild-members', outcome: 'success' },
              effect,
            )
          })()

    return publication === 'fenced'
      ? { section, outcome: 'preserved', error: `${section} effect was fenced` }
      : { section, outcome: 'published' }
  } catch (error) {
    const retry = retryMetadata(error)
    const provenance = {
      source: section === 'profile' ? ('v1-guild-stats' as const) : ('v1-guild-members' as const),
      outcome: retry?.outcome ?? ('ambiguous-failure' as const),
    }
    if (section === 'profile') await clans.recordProfileCheck(clanId, checkedAt, provenance, effect)
    else await clans.recordRosterCheck(clanId, checkedAt, provenance, effect)
    if (retry) throw error
    return { section, outcome: 'preserved', error: error instanceof Error ? error.message : 'Unknown source failure' }
  }
}

export async function processRefreshClan(
  dependencies: { clans: PostgresClans; source: ClanSource },
  clanId: number,
  caller: 'on-demand' | 'background' = 'background',
): Promise<ClanRefreshResult[]> {
  return Promise.all(
    (['profile', 'roster'] as const).map((section) =>
      processRefreshClanSection(dependencies.clans, dependencies.source, clanId, section, caller),
    ),
  )
}
