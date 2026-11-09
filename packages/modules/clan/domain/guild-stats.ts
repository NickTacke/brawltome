import { isSourceRecord, parseDecimal, parseSourceDate, parseText } from './source-values'

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

const maximumClanNameLength = 256

function parseTags(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string')) {
    throw new Error('guild stats tags must be a complete string array')
  }

  return value
}

/** Checks a guild stats payload for the clan and turns it into the profile to store. */
export function parseGuildStats(payload: unknown, clanId: number): ClanProfileWrite {
  if (!isSourceRecord(payload) || payload.guild_id !== clanId) {
    throw new Error('guild stats payload has an unexpected guild ID')
  }

  const tags = parseTags(payload.tags)

  if (typeof payload.is_recruiting !== 'boolean') throw new Error('guild stats is_recruiting must be boolean')

  const currentXp = parseDecimal(payload.xp, 'guild stats xp')
  const legacyXp = parseDecimal(payload.legacy_xp, 'guild stats legacy_xp')
  const lifetimeXp = BigInt(currentXp) + BigInt(legacyXp)

  return {
    clanId,
    clanName: parseText(payload.name, 'guild stats name', {
      maximumLength: maximumClanNameLength,
      isVisibleTextRequired: true,
    }),
    clanCreateDate: parseSourceDate(payload.create_date, 'guild stats create_date'),
    clanXp: currentXp,
    clanLifetimeXp: lifetimeXp.toString(),
    notice: parseText(payload.notice, 'guild stats notice'),
    tags,
    discordInviteCode: parseText(payload.discord_invite_code, 'guild stats discord_invite_code'),
    guildPoints: parseDecimal(payload.guild_points, 'guild stats guild_points'),
    isRecruiting: payload.is_recruiting,
  }
}

/** The rank V1 sends with a guild's stats, or null when it sends none. Optional, so it never fails the stats. */
export function parseGuildRank(payload: unknown): number | null {
  if (!isSourceRecord(payload)) return null

  const { rank } = payload

  if (typeof rank !== 'number' || !Number.isSafeInteger(rank) || rank < 1) return null

  return rank
}
