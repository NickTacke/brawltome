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

/**
 * Populate the module-level emoji cache used for resolving emoji by key.
 *
 * @param cache - Map where keys are emoji lookup keys (e.g., `avatar_<legend_name>`) and values contain the emoji `id` and `name`
 */
export function setEmojiCache(
  cache: Map<string, { id: string; name: string }>,
): void {
  emojiCache = cache;
}

/**
 * Resolve a cached emoji for a legend name key to a Discord component-compatible emoji object.
 *
 * @param legendNameKey - Legend name key used to look up the emoji in the cache; spaces and case are normalized (e.g., "Foo Bar" → "avatar_foo_bar").
 * @returns A `ComponentEmojiResolvable` object containing `id` and `name` if the emoji is found, `undefined` otherwise.
 */
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
 * Creates an ActionRow containing a player selection menu for switching between search results.
 *
 * The menu is populated with up to 25 players. Each option's label is the player's name and its description is
 * either "rating • tier" when both are available, the tier when present, or "Unranked" otherwise. If a player's
 * `bestLegendNameKey` resolves to a cached emoji, that emoji is attached to the option. The option whose
 * `brawlhallaId` matches `selectedId` is marked as the default selection.
 *
 * @param players - Player options used to build the menu (only the first 25 are included)
 * @param selectedId - The `brawlhallaId` of the player to mark as selected
 * @returns An ActionRowBuilder containing a StringSelectMenu populated with the provided players
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
 * Create a select menu populated with clan options for switching between clan search results.
 *
 * @param clans - Array of clan entries to display in the menu
 * @param selectedId - Clan ID to mark as the currently selected option
 * @returns An ActionRowBuilder containing a StringSelectMenuBuilder with one option per clan (up to 25). Each option's value is the clan's ID as a string; the option matching `selectedId` is marked as default and each option shows the clan's member count and a castle emoji.
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

/**
 * Shortens a string to fit within a maximum length, appending an ellipsis when truncated.
 *
 * @param str - The input string to truncate
 * @param maxLength - The maximum allowed length of the returned string (including the trailing `...` when truncation occurs)
 * @returns The original string if it is no longer than `maxLength`, otherwise a shortened string ending with `...` with total length equal to `maxLength`
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}