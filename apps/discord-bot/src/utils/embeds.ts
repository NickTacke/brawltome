import { EmbedBuilder, Colors } from 'discord.js';
import type { PlayerResponse, ClanResponse } from '../api/client.js';
import { getBannerEmoji, getAvatarEmoji, getWeaponEmoji } from './emojis.js';

// Tier color mapping
const TIER_COLORS: Record<string, number> = {
  Valhallan: 0xffd700,
  Diamond: 0x35228a,
  Platinum: 0x275dc8,
  Gold: 0xffc107,
  Silver: 0x808080,
  Bronze: 0x5c4033,
  Tin: 0xb0b0b0,
  Unranked: Colors.DarkGrey,
};

/**
 * Selects an embed color corresponding to the player's tier.
 *
 * @param tier - Tier string (e.g., "Gold IV", "Platinum", or undefined/null for unranked)
 * @returns The numeric color value associated with the tier, or DarkGrey if the tier is unknown
 */
function getTierColor(tier: string): number {
  const baseTier = tier?.split(' ')[0] || 'Unranked';
  return TIER_COLORS[baseTier] || Colors.DarkGrey;
}

/**
 * Format a duration given in seconds as a compact playtime string.
 *
 * @param seconds - Duration in seconds
 * @returns A string like `"<Nh"` when at least one hour, otherwise `"<Nm"` for minutes
 */
function formatPlaytime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${Math.floor(seconds / 60)}m`;
}

/**
 * Calculate the win-rate percentage and return it as a whole-number string with a trailing percent sign.
 *
 * @param wins - Number of wins
 * @param games - Total number of games played
 * @returns The win rate rounded to the nearest whole percent with a trailing `%`, or `"0%"` when `games` is 0
 */
function formatWinRate(wins: number, games: number): string {
  if (games === 0) return '0%';
  return `${((wins / games) * 100).toFixed(0)}%`;
}

/**
 * Format a number using compact suffixes ("K" for thousands, "M" for millions).
 *
 * @returns The input formatted as a string with one decimal when suffixed (e.g., `1.2K`, `3.4M`), or the integer as a string when less than 1000.
 */
function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Produce the public avatar image URL for a legend key.
 *
 * @param legendNameKey - The legend's identifier (e.g., "Bodvar" or a key-like name); may be undefined
 * @returns The absolute avatar image URL for the legend, or `null` if `legendNameKey` is not provided
 */
function getLegendAvatarUrl(legendNameKey: string | undefined): string | null {
  if (!legendNameKey) return null;
  const key = legendNameKey.toLowerCase().replace(/\s+/g, '_');
  return `https://brawltome.com/images/legends/avatars/${key}.png`;
}

/**
 * Constructs a Discord EmbedBuilder presenting a player's profile, key stats, top legends, weapons, and 2v2 teams.
 *
 * The embed includes title, tier-based color and emoji, profile URL, optional thumbnail from the player's top XP legend,
 * a description with tier/rating/peak and win-loss summary, optional clan link, inline "Stats" block, "Most Played" legends,
 * "Weapons" usage, and "2v2 Teams" performance. Footer contains the player's region, refresh state, and site tag.
 *
 * @param player - The PlayerResponse object from the API used to populate the embed
 * @returns The populated EmbedBuilder for the given player
 */
export function buildPlayerEmbed(player: PlayerResponse): EmbedBuilder {
  const tierEmoji = getBannerEmoji(player.tier);

  // Get highest XP legend for avatar
  const topXpLegend = player.stats?.legendsEnriched
    ?.slice()
    .sort((a, b) => b.xp - a.xp)[0];

  const embed = new EmbedBuilder()
    .setTitle(player.name)
    .setColor(getTierColor(player.tier))
    .setURL(`https://brawltome.com/player/${player.brawlhallaId}`);

  // Thumbnail: highest XP legend
  if (topXpLegend) {
    const avatarUrl = getLegendAvatarUrl(topXpLegend.legendNameKey);
    if (avatarUrl) embed.setThumbnail(avatarUrl);
  }

  // Description with key stats
  const descLines = [
    `${tierEmoji} **${player.tier || 'Unranked'}** • **${
      player.rating || 0
    }** / ${player.peakRating || 0} Elo`,
  ];

  if (player.games > 0) {
    descLines.push(
      `**${player.wins}W** / **${
        player.games - player.wins
      }L** (${formatWinRate(player.wins, player.games)})`,
    );
  }

  if (player.stats?.clan) {
    const clanLink = `[${player.stats.clan.clanName}](https://brawltome.com/clan/${player.stats.clan.clanId})`;
    descLines.push(`🏰 ${clanLink}`);
  }

  embed.setDescription(descLines.join('\n'));

  // General stats (inline)
  if (player.stats) {
    embed.addFields({
      name: '📊 Stats',
      value: [
        `Level **${player.stats.level || 0}**`,
        `Playtime **${formatPlaytime(player.stats.playtimeSeconds || 0)}**`,
        `Games **${formatNumber(player.stats.games || 0)}**`,
      ].join('\n'),
      inline: true,
    });
  }

  // Top legends by XP (top 3)
  if (
    player.stats?.legendsEnriched &&
    player.stats.legendsEnriched.length > 0
  ) {
    const topLegends = player.stats.legendsEnriched
      .slice()
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 3);

    const legendsText = topLegends
      .map((legend) => {
        const emoji = getAvatarEmoji(legend.legendNameKey);
        const name = legend.bioName || legend.legendNameKey;
        return `${emoji} **${name}** Lv${legend.level}`;
      })
      .join('\n');

    embed.addFields({
      name: '⭐ Most Played',
      value: legendsText,
      inline: true,
    });
  }

  // Top weapons (top 3 by time held)
  if (player.stats?.weaponStats && player.stats.weaponStats.length > 0) {
    const topWeapons = player.stats.weaponStats
      .slice()
      .sort((a, b) => b.timeHeld - a.timeHeld)
      .slice(0, 3);

    const weaponsText = topWeapons
      .map((weapon) => {
        const emoji = getWeaponEmoji(weapon.weapon);
        const pct = Math.round(weapon.share * 100);
        return `${emoji} **${weapon.weapon}** ${pct}%`;
      })
      .join('\n');

    embed.addFields({
      name: '🗡️ Weapons',
      value: weaponsText,
      inline: true,
    });
  }

  // 2v2 teams (top 3)
  if (player.ranked?.teams && player.ranked.teams.length > 0) {
    const topTeams = player.ranked.teams
      .slice()
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);

    const teamsText = topTeams
      .map((team) => {
        const tierBadge = getBannerEmoji(team.tier);
        const wr = formatWinRate(team.wins, team.games);

        // Get teammate info - find which ID is not the current player
        const teammateId =
          team.brawlhallaIdOne === player.brawlhallaId
            ? team.brawlhallaIdTwo
            : team.brawlhallaIdOne;

        // Parse teammate name from team name (format: "Name1+Name2")
        const names = team.teamName.split('+');
        const teammateName =
          names.find((n) => n.toLowerCase() !== player.name.toLowerCase()) ||
          names[0];

        const teammateLink = `[${teammateName}](https://brawltome.com/player/${teammateId})`;

        return `${tierBadge} **${team.rating}** / ${
          team.peakRating
        } - ${teammateLink}\n ${team.wins}W/${team.games - team.wins}L (${wr})`;
      })
      .join('\n');

    embed.addFields({
      name: '👥 2v2 Teams',
      value: teamsText,
      inline: false,
    });
  }

  // Footer
  embed.setFooter({
    text: `${player.region}${
      player.isRefreshing ? ' • 🔄 Refreshing...' : ''
    } • brawltome.app`,
    iconURL: 'https://brawltome.com/images/logo.png',
  });

  embed.setTimestamp();

  return embed;
}

/**
 * Create a Discord embed presenting clan details and top members.
 *
 * Includes member count, formatted clan XP, creation date, up to six top members by XP (each with a rank icon, optional legend emoji, and optional Elo), a footer that reflects refresh state, and a timestamp.
 *
 * @param clan - ClanResponse object containing clan metadata and member list
 * @returns An EmbedBuilder configured with the clan's title, color, URL, thumbnail, description, optional "Top Members" field, footer, and timestamp
 */
export function buildClanEmbed(clan: ClanResponse): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(clan.clanName)
    .setColor(Colors.Blue)
    .setURL(`https://brawltome.com/clan/${clan.clanId}`)
    .setThumbnail('https://brawltome.com/images/logo.png');

  // Description with clan stats
  const xpValue = parseInt(clan.clanXp) || 0;
  embed.setDescription(
    [
      `**${clan.members.length}** members • **${formatNumber(xpValue)}** XP`,
      `Created <t:${Math.floor(
        new Date(clan.clanCreateDate).getTime() / 1000,
      )}:D>`,
    ].join('\n'),
  );

  // Top members by XP
  if (clan.members.length > 0) {
    const sortedMembers = [...clan.members].sort((a, b) => b.xp - a.xp);
    const topMembers = sortedMembers.slice(0, 6);

    const membersText = topMembers
      .map((member, i) => {
        const rankIcon =
          member.rank === 'Leader'
            ? '👑'
            : member.rank === 'Officer'
            ? '⭐'
            : `${i + 1}.`;
        const legendEmoji = member.legendNameKey
          ? getAvatarEmoji(member.legendNameKey)
          : '';
        const elo = member.elo ? `(${member.elo})` : '';
        return `${rankIcon} ${legendEmoji} **${member.name}** ${elo}`;
      })
      .join('\n');

    embed.addFields({
      name: '🏆 Top Members',
      value: membersText,
      inline: false,
    });
  }

  embed.setFooter({
    text: clan.isRefreshing
      ? '🔄 Refreshing... • brawltome.app'
      : 'brawltome.app',
    iconURL: 'https://brawltome.com/images/logo.png',
  });

  embed.setTimestamp();

  return embed;
}

/**
 * Create an error-styled Discord embed with a red color, cross prefix, and standard footer.
 *
 * @param title - Short title for the error embed (will be prefixed with a cross emoji)
 * @param description - Detailed message displayed in the embed body
 * @returns An EmbedBuilder configured as an error embed
 */
export function buildErrorEmbed(
  title: string,
  description: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(Colors.Red)
    .setFooter({
      text: 'BrawlTome',
      iconURL: 'https://brawltome.com/images/logo.png',
    })
    .setTimestamp();
}

/**
 * Builds a Discord embed presenting search results for players and clans.
 *
 * @param query - The search query used to generate results
 * @param players - Matching player records to display; up to 5 entries are shown
 * @param clans - Matching clan records to display; up to 5 entries are shown
 * @returns An EmbedBuilder containing listed players and clans, or a "No results found." description when both lists are empty
 */
export function buildSearchEmbed(
  query: string,
  players: Array<{
    brawlhallaId: number;
    name: string;
    rating: number;
    tier: string;
    bestLegendNameKey?: string;
  }>,
  clans: Array<{
    clanId: number;
    name: string;
    memberCount: number;
  }>,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🔍 "${query}"`)
    .setColor(Colors.Blurple);

  if (players.length > 0) {
    const playersText = players
      .slice(0, 5)
      .map((p) => {
        const tierEmoji = getBannerEmoji(p.tier);
        return `${tierEmoji} **${p.name}** • ${p.rating || 'Unranked'}`;
      })
      .join('\n');

    embed.addFields({
      name: `Players (${players.length})`,
      value: playersText,
      inline: false,
    });
  }

  if (clans.length > 0) {
    const clansText = clans
      .slice(0, 5)
      .map((c) => `🏰 **${c.name}** • ${c.memberCount} members`)
      .join('\n');

    embed.addFields({
      name: `Clans (${clans.length})`,
      value: clansText,
      inline: false,
    });
  }

  if (players.length === 0 && clans.length === 0) {
    embed.setDescription('No results found.');
  }

  return embed;
}