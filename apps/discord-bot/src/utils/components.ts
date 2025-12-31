import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentEmojiResolvable,
} from 'discord.js';

interface PlayerOption {
  brawlhallaId: number;
  name: string;
  rating: number;
  tier: string;
  region?: string;
  bestLegendNameKey?: string;
}

interface ClanOption {
  clanId: number;
  name: string;
  memberCount: number;
}

// Emoji cache reference (will be populated by emojis.ts)
let emojiCache: Map<string, { id: string; name: string }> | null = null;

export function setEmojiCache(
  cache: Map<string, { id: string; name: string }>,
): void {
  emojiCache = cache;
}

function getEmojiForSelect(
  legendNameKey: string,
): ComponentEmojiResolvable | undefined {
  if (!emojiCache) return undefined;

  const key = `avatar_${legendNameKey?.toLowerCase().replace(/\s+/g, '_')}`;
  const emoji = emojiCache.get(key);

  if (emoji) {
    return { id: emoji.id, name: emoji.name };
  }
  return undefined;
}

/**
 * Build a select menu for switching between player search results
 */
export function buildPlayerSelectMenu(
  players: PlayerOption[],
  selectedId: number,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId('player_select')
    .setPlaceholder('Switch player...')
    .addOptions(
      players.slice(0, 25).map((p) => {
        // Build a clean description
        const ratingStr = p.rating && p.rating > 0 ? p.rating.toString() : null;
        const tierStr = p.tier && p.tier !== 'Unranked' ? p.tier : null;
        const description =
          ratingStr && tierStr
            ? `${ratingStr} • ${tierStr}`
            : tierStr || 'Unranked';

        const option = new StringSelectMenuOptionBuilder()
          .setLabel(truncate(p.name, 100))
          .setDescription(truncate(description, 100))
          .setValue(p.brawlhallaId.toString())
          .setDefault(p.brawlhallaId === selectedId);

        // Try to add legend emoji
        if (p.bestLegendNameKey) {
          const emoji = getEmojiForSelect(p.bestLegendNameKey);
          if (emoji) {
            option.setEmoji(emoji);
          }
        }

        return option;
      }),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/**
 * Build a select menu for switching between clan search results
 */
export function buildClanSelectMenu(
  clans: ClanOption[],
  selectedId: number,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId('clan_select')
    .setPlaceholder('Switch clan...')
    .addOptions(
      clans.slice(0, 25).map((c) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncate(c.name, 100))
          .setDescription(`${c.memberCount} members`)
          .setValue(c.clanId.toString())
          .setDefault(c.clanId === selectedId)
          .setEmoji('🏰'),
      ),
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
