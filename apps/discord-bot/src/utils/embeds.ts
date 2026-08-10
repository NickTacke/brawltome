import { Colors, EmbedBuilder } from 'discord.js'
import type { CanonicalPlayerResponse, ClanRefreshResponse, ClanResponse, PlayerRefreshResponse } from '../lib/types'
import { getBannerEmoji } from './emojis'
import { escapeDiscordText } from './text'

const TIER_COLORS: Record<string, number> = {
  Valhallan: 0xffd700,
  Diamond: 0x35228a,
  Platinum: 0x275dc8,
  Gold: 0xffc107,
  Silver: 0x808080,
  Bronze: 0x5c4033,
  Tin: 0xb0b0b0,
  Unranked: Colors.DarkGrey,
}

function getTierColor(tier: string | null): number {
  const baseTier = tier?.split(' ')[0] || 'Unranked'
  return TIER_COLORS[baseTier] || Colors.DarkGrey
}

function formatPlaytime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  if (hours > 0) {
    return `${hours}h`
  }
  return `${Math.floor(seconds / 60)}m`
}

function formatNumber(num: number | bigint): string {
  const n = Number(num)
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toString()
}

function getLegendAvatarUrl(legendNameKey: string | undefined): string | null {
  if (!legendNameKey) return null
  const key = legendNameKey.toLowerCase().replace(/\s+/g, '_')
  return `https://brawltome.app/images/legends/avatars/${key}.png`
}

function refreshActive(refresh: PlayerRefreshResponse['refresh'] | ClanRefreshResponse['refresh']): boolean {
  return refresh.outcome === 'accepted' || refresh.outcome === 'alreadyRefreshing'
}

function updatedLabel(
  lastSuccessAt: string | null,
  freshness: 'fresh' | 'stale' | 'unavailable',
  active: boolean,
): string {
  if (active && freshness !== 'fresh') return 'Refreshing'
  if (!lastSuccessAt || freshness === 'unavailable') return 'Unavailable'
  const unixSeconds = Math.floor(new Date(lastSuccessAt).getTime() / 1_000)
  const updated = Number.isFinite(unixSeconds) ? `Updated <t:${unixSeconds}:R>` : 'Updated'
  return freshness === 'stale' ? `Update delayed • ${updated}` : updated
}

function retryLabel(
  refresh: PlayerRefreshResponse['refresh'] | ClanRefreshResponse['refresh'],
  now: number,
): string | null {
  if (refresh.outcome !== 'rateLimited' && refresh.outcome !== 'temporarilyUnavailable') return null
  const retryAt = Math.floor(now / 1_000) + refresh.retry.afterSeconds
  return `Update delayed. Try again <t:${retryAt}:R>.`
}

export function buildCanonicalPlayerEmbed(
  player: CanonicalPlayerResponse,
  refresh: PlayerRefreshResponse['refresh'],
  now = Date.now(),
): EmbedBuilder {
  const ranked = player.currentSeason
  const rankedSnapshot = ranked?.snapshot
  const career = player.career
  const careerSnapshot = career?.snapshot
  const tier = rankedSnapshot?.oneVsOne.tier ?? null
  const embed = new EmbedBuilder()
    .setTitle(escapeDiscordText(player.reference.name))
    .setColor(getTierColor(tier))
    .setURL(`https://brawltome.app/player/${player.reference.brawlhallaId}`)

  const mainLegend = rankedSnapshot?.mainLegend?.legendNameKey
  const avatarUrl = getLegendAvatarUrl(mainLegend)
  if (avatarUrl) embed.setThumbnail(avatarUrl)

  const retry = retryLabel(refresh, now)
  if (retry) embed.setDescription(retry)

  const competitive = rankedSnapshot
    ? [
        `${getBannerEmoji(rankedSnapshot.oneVsOne.tier)} **${rankedSnapshot.oneVsOne.tier}**`,
        `**${rankedSnapshot.oneVsOne.rating}** rating • **${rankedSnapshot.oneVsOne.peakRating}** peak`,
        `**${rankedSnapshot.oneVsOne.wins}W** / **${rankedSnapshot.oneVsOne.games - rankedSnapshot.oneVsOne.wins}L**`,
      ].join('\n')
    : 'Unavailable'
  embed.addFields({ name: 'Competitive Snapshot', value: competitive, inline: false })

  const active = refreshActive(refresh)
  const currentSeason = [updatedLabel(ranked?.lastSuccessAt ?? null, ranked?.freshness ?? 'unavailable', active)]
  if (rankedSnapshot) {
    currentSeason.push(
      rankedSnapshot.rankedLegends.length > 0
        ? `${rankedSnapshot.rankedLegends.length} ranked legends observed`
        : 'No ranked legend games observed',
    )
  }
  embed.addFields({ name: 'Current Season', value: currentSeason.join('\n'), inline: true })

  const careerLines = [updatedLabel(career?.lastSuccessAt ?? null, career?.freshness ?? 'unavailable', active)]
  if (careerSnapshot) {
    careerLines.push(
      `Level **${careerSnapshot.account.level}**`,
      `Games **${formatNumber(careerSnapshot.combat.games)}**`,
      `Playtime **${formatPlaytime(careerSnapshot.combat.matchTime)}**`,
    )
  }
  embed.addFields({ name: 'Career Statistics', value: careerLines.join('\n'), inline: true })

  embed.setFooter({ text: 'BrawlTome-observed • brawltome.app' }).setTimestamp()
  return embed
}

function clanSectionLabel(lastSuccessAt: string | null | undefined, now: number, active: boolean): string {
  if (active && !lastSuccessAt) return 'Refreshing'
  if (!lastSuccessAt) return 'Unavailable'
  const timestamp = new Date(lastSuccessAt).getTime()
  if (!Number.isFinite(timestamp)) return 'Unavailable'
  const updated = `Updated <t:${Math.floor(timestamp / 1_000)}:R>`
  if (active && now - timestamp > 60 * 60 * 1_000) return 'Refreshing'
  return now - timestamp > 60 * 60 * 1_000 ? `Update delayed • ${updated}` : updated
}

export function buildClanEmbed(
  clan: ClanResponse,
  page = 0,
  refresh?: ClanRefreshResponse['refresh'],
  now = Date.now(),
): EmbedBuilder {
  const ITEMS_PER_PAGE = 5
  const embed = new EmbedBuilder()
    .setTitle(escapeDiscordText(clan.clanName))
    .setColor(0x35228a)
    .setURL(`https://brawltome.com/clan/${clan.clanId}`)
    .setThumbnail('https://brawltome.app/images/logo.png')

  if (refresh) {
    const retry = retryLabel(refresh, now)
    if (retry) embed.setDescription(retry)
  }

  const formatDecimal = (value: string) => BigInt(value).toLocaleString('en-US')
  const active = refresh ? refreshActive(refresh) : false
  const rosterAvailable = clan.roster?.lastSuccessAt != null
  const totalPages = rosterAvailable ? Math.ceil(clan.members.length / ITEMS_PER_PAGE) : 0

  embed.addFields({
    name: '📋 Clan Info',
    value: [
      `👥 **Members**: ${rosterAvailable ? clan.members.length : '**Unavailable**'}`,
      `✨ **Total XP**: ${formatDecimal(clan.clanXp)}`,
      `📅 **Created**: <t:${Math.floor(new Date(clan.clanCreateDate).getTime() / 1000)}:D>`,
      `Profile: ${clanSectionLabel(clan.profile.lastSuccessAt, now, active)}`,
      `Roster: ${clanSectionLabel(clan.roster?.lastSuccessAt, now, active)}`,
    ].join('\n'),
    inline: false,
  })

  if (rosterAvailable && clan.members.length > 0) {
    const sortedMembers = [...clan.members].sort((a, b) => {
      const left = BigInt(a.xp)
      const right = BigInt(b.xp)
      return left === right ? 0 : left > right ? -1 : 1
    })
    const start = page * ITEMS_PER_PAGE
    const pageMembers = sortedMembers.slice(start, start + ITEMS_PER_PAGE)

    const membersText = pageMembers
      .map((member, i) => {
        const rank = start + i + 1
        const rankIcon = member.rank === 'Leader' ? '👑' : member.rank === 'Officer' ? '⭐' : `\`${rank}.\``

        const memberLink = `[${escapeDiscordText(truncate(member.name, 20))}](https://brawltome.app/player/${member.brawlhallaId})`
        const memberXp = ` • \`${formatDecimal(member.xp)} XP\``

        return `${rankIcon} **${memberLink}**${memberXp}`
      })
      .join('\n')

    embed.addFields({
      name: `🏆 Members (Page ${page + 1}/${totalPages})`,
      value: membersText || 'No members on this page.',
      inline: false,
    })
  }

  embed.setFooter({
    text: 'brawltome.app',
    iconURL: 'https://brawltome.com/images/logo.png',
  })

  embed.setTimestamp()

  return embed
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return `${str.slice(0, maxLength - 3)}...`
}

export function buildErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(Colors.Red)
    .setFooter({
      text: 'BrawlTome',
      iconURL: 'https://brawltome.com/images/logo.png',
    })
    .setTimestamp()
}

export function buildSearchEmbed(
  query: string,
  players: Array<{
    brawlhallaId: number
    name: string
    rating: number
    tier: string | null
    bestLegendNameKey?: string | null
  }>,
  clans: Array<{
    clanId: number
    clanName: string
    memberCount: number
  }>,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(`🔍 "${query}"`).setColor(Colors.Blurple)

  if (players.length > 0) {
    const playersText = players
      .slice(0, 5)
      .map((p) => {
        const tierEmoji = getBannerEmoji(p.tier)
        return `${tierEmoji} **${p.name}** • ${p.rating || 'Unranked'}`
      })
      .join('\n')

    embed.addFields({
      name: `Players (${players.length})`,
      value: playersText,
      inline: false,
    })
  }

  if (clans.length > 0) {
    const clansText = clans
      .slice(0, 5)
      .map((c) => `🏰 **${c.clanName}** • ${c.memberCount} members`)
      .join('\n')

    embed.addFields({
      name: `Clans (${clans.length})`,
      value: clansText,
      inline: false,
    })
  }

  if (players.length === 0 && clans.length === 0) {
    embed.setDescription('No results found.')
  }

  return embed
}
