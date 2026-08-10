import { Colors, EmbedBuilder } from 'discord.js'
import type { ClanResponse, PlayerResponse } from '../lib/types'
import { getAvatarEmoji, getBannerEmoji, getWeaponEmoji } from './emojis'

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

function formatWinRate(wins: number, games: number): string {
  if (games === 0) return '0%'
  return `${((wins / games) * 100).toFixed(0)}%`
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
  return `https://brawltome.com/images/legends/avatars/${key}.png`
}

export function buildPlayerEmbed(player: PlayerResponse): EmbedBuilder {
  const tierEmoji = getBannerEmoji(player.tier)

  const topXpLegend = player.statsLegends?.slice().sort((a, b) => b.xp - a.xp)[0]

  const embed = new EmbedBuilder()
    .setTitle(player.name)
    .setColor(getTierColor(player.tier))
    .setURL(`https://brawltome.com/player/${player.brawlhallaId}`)

  if (topXpLegend) {
    const avatarUrl = getLegendAvatarUrl(topXpLegend.legendNameKey)
    if (avatarUrl) embed.setThumbnail(avatarUrl)
  }

  const descLines = [
    `${tierEmoji} **${player.tier || 'Unranked'}** • **${player.rating || 0}** / ${player.peakRating || 0} Elo`,
  ]

  if (player.rankedGames > 0) {
    descLines.push(
      `**${player.rankedWins}W** / **${
        player.rankedGames - player.rankedWins
      }L** (${formatWinRate(player.rankedWins, player.rankedGames)})`,
    )
  }

  if (player.clan) {
    const clanLink = `[${player.clan.clanName}](https://brawltome.com/clan/${player.clan.clanId})`
    descLines.push(`🏰 ${clanLink}`)
  }

  embed.setDescription(descLines.join('\n'))

  if (player.level != null) {
    embed.addFields({
      name: '📊 Stats',
      value: [
        `Level **${player.level || 0}**`,
        `Playtime **${formatPlaytime(player.matchTimeTotal || 0)}**`,
        `Games **${formatNumber(player.totalGames || 0)}**`,
      ].join('\n'),
      inline: true,
    })
  }

  if (player.statsLegends && player.statsLegends.length > 0) {
    const topLegends = player.statsLegends
      .slice()
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 3)

    const legendsText = topLegends
      .map((legend) => {
        const emoji = getAvatarEmoji(legend.legendNameKey)
        const name = legend.bioName || legend.legendNameKey
        return `${emoji} **${name}** Lv${legend.level}`
      })
      .join('\n')

    embed.addFields({
      name: '⭐ Most Played',
      value: legendsText,
      inline: true,
    })
  }

  if (player.weaponStats && player.weaponStats.length > 0) {
    const topWeapons = player.weaponStats
      .slice()
      .sort((a, b) => b.timeHeld - a.timeHeld)
      .slice(0, 3)

    const weaponsText = topWeapons
      .map((weapon) => {
        const emoji = getWeaponEmoji(weapon.weapon)
        const playtime = formatPlaytime(weapon.timeHeld)
        return `${emoji} **${weapon.weapon}** ${playtime}`
      })
      .join('\n')

    embed.addFields({
      name: '🗡️ Weapons',
      value: weaponsText,
      inline: true,
    })
  }

  if (player.rankedTeams && player.rankedTeams.length > 0) {
    const topTeams = player.rankedTeams
      .slice()
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3)

    const teamsText = topTeams
      .map((team) => {
        const tierBadge = getBannerEmoji(team.tier)
        const wr = formatWinRate(team.wins, team.games)

        const teammateId = team.brawlhallaIdOne === player.brawlhallaId ? team.brawlhallaIdTwo : team.brawlhallaIdOne

        const names = team.teamName.split('+')
        const teammateName = names.find((n) => n.toLowerCase() !== player.name.toLowerCase()) || names[0]

        const teammateLink = `[${teammateName}](https://brawltome.com/player/${teammateId})`

        return `${tierBadge} **${team.rating}** / ${
          team.peakRating
        } - ${teammateLink}\n ${team.wins}W/${team.games - team.wins}L (${wr})`
      })
      .join('\n')

    embed.addFields({
      name: '👥 2v2 Teams',
      value: teamsText,
      inline: false,
    })
  }

  embed.setFooter({
    text: `${player.region ?? 'Unknown'} • brawltome.app`,
    iconURL: 'https://brawltome.com/images/logo.png',
  })

  embed.setTimestamp()

  return embed
}

export function buildClanEmbed(clan: ClanResponse, page = 0): EmbedBuilder {
  const ITEMS_PER_PAGE = 5
  const embed = new EmbedBuilder()
    .setTitle(clan.clanName)
    .setColor(0x35228a)
    .setURL(`https://brawltome.com/clan/${clan.clanId}`)
    .setThumbnail('https://brawltome.com/images/logo.png')

  const formatDecimal = (value: string) => BigInt(value).toLocaleString('en-US')
  const totalPages = Math.ceil(clan.members.length / ITEMS_PER_PAGE)

  embed.addFields({
    name: '📋 Clan Info',
    value: [
      `👥 **Members**: ${clan.members.length}`,
      `✨ **Total XP**: ${formatDecimal(clan.clanXp)}`,
      `📅 **Created**: <t:${Math.floor(new Date(clan.clanCreateDate).getTime() / 1000)}:D>`,
    ].join('\n'),
    inline: false,
  })

  if (clan.members.length > 0) {
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

        const memberLink = `[${truncate(member.name, 20)}](https://brawltome.com/player/${member.brawlhallaId})`
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
