import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentEmojiResolvable,
  ButtonBuilder,
  ButtonStyle,
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
  interactionId?: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const customId = interactionId
    ? `player_select:${interactionId}`
    : 'player_select';

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
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
  interactionId?: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const customId = interactionId
    ? `clan_select:${interactionId}`
    : 'clan_select';

  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
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

/**
 * Build buttons for clan member pagination
 */
export function buildClanPaginationButtons(
  interactionId: string,
  currentPage: number,
  totalMembers: number,
): ActionRowBuilder<ButtonBuilder> {
  const ITEMS_PER_PAGE = 5;
  const totalPages = Math.ceil(totalMembers / ITEMS_PER_PAGE);

  const prevButton = new ButtonBuilder()
    .setCustomId(`clan_page:${interactionId}:${currentPage - 1}`)
    .setLabel('Previous')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage <= 0);

  const nextButton = new ButtonBuilder()
    .setCustomId(`clan_page:${interactionId}:${currentPage + 1}`)
    .setLabel('Next')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentPage >= totalPages - 1);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    prevButton,
    nextButton,
  );
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
