import {
  isSourceRecord,
  parseDecimal,
  parseNonNegativeInteger,
  parseOptionalDecimal,
  parseOptionalSourceDate,
  parseOptionalText,
} from './source-values'

// name, rank, join date and guild points are null when the source left them out
export type ClanMemberWrite = {
  brawlhallaId: number
  name: string | null
  rank: string | null
  joinDate: Date | null
  xp: string
  guildPoints: string | null
}

const maximumNameLength = 256
const maximumRankLength = 64

function memberField(index: number, name: string): string {
  return `guild member ${index} ${name}`
}

function parseMemberDetails(raw: Record<string, unknown>, index: number, brawlhallaId: number): ClanMemberWrite {
  return {
    brawlhallaId,
    name: parseOptionalText(raw.name, memberField(index, 'name'), maximumNameLength),
    rank: parseOptionalText(raw.rank, memberField(index, 'rank'), maximumRankLength),
    joinDate: parseOptionalSourceDate(raw.join_date, memberField(index, 'join_date')),
    xp: parseDecimal(raw.xp, memberField(index, 'xp')),
    guildPoints: parseOptionalDecimal(raw.guild_points, memberField(index, 'guild_points')),
  }
}

/**
 * Checks a guild members payload for the clan and turns it into the roster to store. Only a complete, valid roster
 * passes, because publishing it removes every member it leaves out.
 */
export function parseGuildMembers(payload: unknown, clanId: number): ClanMemberWrite[] {
  if (!isSourceRecord(payload) || payload.guild_id !== clanId) {
    throw new Error('guild members payload has an unexpected guild ID')
  }

  if (!Array.isArray(payload.guild_members)) throw new Error('guild_members must be a complete array')

  const seenIds = new Set<number>()

  return payload.guild_members.map((raw, index) => {
    if (!isSourceRecord(raw)) throw new Error(`guild member ${index} must be an object`)

    const brawlhallaId = parseNonNegativeInteger(raw.brawlhalla_id, memberField(index, 'brawlhalla_id'))

    if (brawlhallaId === 0 || seenIds.has(brawlhallaId)) {
      throw new Error('guild roster contains an invalid duplicate player ID')
    }

    seenIds.add(brawlhallaId)

    return parseMemberDetails(raw, index, brawlhallaId)
  })
}
