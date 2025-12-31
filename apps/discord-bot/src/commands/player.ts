import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  Message,
  InteractionResponse,
} from 'discord.js';
import * as api from '../api/client.js';
import { buildPlayerEmbed, buildErrorEmbed } from '../utils/embeds.js';
import { buildPlayerSelectMenu } from '../utils/components.js';
import { pollForFreshData } from '../utils/refresh.js';
import type { Command } from './index.js';

// Cache search results for select menu interactions (expires after 5 minutes)
const searchCache = new Map<
  string,
  { players: api.SearchResponse['players']; timestamp: number }
>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const playerCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Look up a Brawlhalla player')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Player name or Brawlhalla ID')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query', true).trim();

    await interaction.deferReply();

    try {
      // Check if query is a numeric ID
      const numericId = parseInt(query, 10);
      const isNumericId = !isNaN(numericId) && query === numericId.toString();

      let playerId: number;
      let searchResults: api.SearchResponse['players'] = [];

      if (isNumericId) {
        // Direct ID lookup
        playerId = numericId;
      } else {
        // Search by name
        const results = await api.search(query);
        searchResults = results.players;

        if (searchResults.length === 0) {
          await interaction.editReply({
            embeds: [
              buildErrorEmbed(
                'Player Not Found',
                `No players found matching "${query}". Try searching with a Brawlhalla ID instead.`,
              ),
            ],
          });
          return;
        }

        // Use the best result (first one, sorted by rating)
        playerId = searchResults[0].brawlhallaId;
      }

      // Fetch player data
      const player = await api.getPlayer(playerId);
      const embed = buildPlayerEmbed(player);

      // Build response with optional select menu
      const responseOptions: {
        embeds: ReturnType<typeof buildPlayerEmbed>[];
        components?: ReturnType<typeof buildPlayerSelectMenu>[];
      } = { embeds: [embed] };

      // Add select menu if there are multiple search results
      if (searchResults.length > 1) {
        responseOptions.components = [
          buildPlayerSelectMenu(searchResults, playerId),
        ];

        // Cache the search results for select menu interactions
        const cacheKey = interaction.id;
        searchCache.set(cacheKey, {
          players: searchResults,
          timestamp: Date.now(),
        });

        // Clean up old cache entries
        cleanupCache();
      }

      const reply = await interaction.editReply(responseOptions);

      // If data is refreshing, start polling
      if (player.isRefreshing && reply instanceof Message) {
        void pollForFreshData(reply, playerId, 'player', searchResults);
      }
    } catch (error) {
      console.error('[Player Command] Error:', error);

      if (error instanceof api.ApiError) {
        if (error.status === 404) {
          await interaction.editReply({
            embeds: [
              buildErrorEmbed(
                'Player Not Found',
                `Could not find a player with that ID. Make sure you're using a valid Brawlhalla ID.`,
              ),
            ],
          });
          return;
        }

        if (error.status === 429) {
          await interaction.editReply({
            embeds: [
              buildErrorEmbed(
                'Rate Limited',
                'The API is currently busy. Please try again in a few minutes.',
              ),
            ],
          });
          return;
        }
      }

      await interaction.editReply({
        embeds: [
          buildErrorEmbed(
            'Error',
            'Something went wrong while fetching player data. Please try again later.',
          ),
        ],
      });
    }
  },
};

/**
 * Update the interaction response when a player is selected from the player select menu.
 *
 * Defers the update, fetches the selected player's data, and edits the original reply with a player embed.
 * If the original message contains the player select menu, the menu is rebuilt to preserve options and reflect the new selection.
 * If the fetched player is in a refreshing state, starts polling the message for fresh data.
 * On failure, replaces the reply with a generic error embed and clears components.
 *
 * @param interaction - The StringSelectMenuInteraction triggered by selecting a player option
 */
export async function handlePlayerSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const playerId = parseInt(interaction.values[0], 10);

  await interaction.deferUpdate();

  try {
    const player = await api.getPlayer(playerId);
    const embed = buildPlayerEmbed(player);

    // Get cached search results to preserve the select menu
    const message = interaction.message;
    const components = message.components;

    // Update the select menu to show the new selection
    if (components.length > 0) {
      const selectMenu = buildPlayerSelectMenu(
        getPlayersFromMessage(message, playerId),
        playerId,
      );

      const reply = await interaction.editReply({
        embeds: [embed],
        components: [selectMenu],
      });

      if (player.isRefreshing && reply instanceof Message) {
        void pollForFreshData(
          reply,
          playerId,
          'player',
          getPlayersFromMessage(message, playerId),
        );
      }
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('[Player Select] Error:', error);
    await interaction.editReply({
      embeds: [
        buildErrorEmbed(
          'Error',
          'Something went wrong while fetching player data.',
        ),
      ],
      components: [],
    });
  }
}

/**
 * Retrieve player entries represented by a message's StringSelect menu so the same options can be preserved.
 *
 * @param message - The message or interaction response that contains the select menu component
 * @param selectedId - The selected player ID to use as a fallback if the menu options cannot be parsed
 * @returns An array of player-like objects derived from the select menu options. If parsing fails, returns a single minimal entry with `brawlhallaId` equal to `selectedId`
 */
function getPlayersFromMessage(
  message: Message<boolean> | InteractionResponse<boolean>,
  selectedId: number,
): api.SearchResponse['players'] {
  try {
    if (!('components' in message)) return [];
    const row = message.components[0];
    if (!row || !('components' in row)) return [];

    const select = row.components[0];
    if (!select || select.type !== 3) return []; // 3 = StringSelect

    interface SelectOption {
      label: string;
      value: string;
      description?: string;
      emoji?: { name?: string };
    }

    const options: SelectOption[] =
      'data' in select
        ? (select.data as { options?: SelectOption[] }).options || []
        : [];

    return options.map((opt) => {
      // Parse description: "1847 • Platinum 3" or just take as-is
      const desc = opt.description || '';
      const parts = desc.split(' • ');
      const rating = parseInt(parts[0], 10) || 0;
      const tier = parts[1] || parts[0] || 'Unranked';

      // Extract legend name from emoji (e.g., "avatar_bodvar" -> "bodvar")
      let bestLegendNameKey: string | undefined;
      if (opt.emoji?.name?.startsWith('avatar_')) {
        bestLegendNameKey = opt.emoji.name.replace('avatar_', '');
      }

      return {
        brawlhallaId: parseInt(opt.value, 10),
        name: opt.label,
        region: '',
        rating,
        tier,
        games: 0,
        wins: 0,
        bestLegendNameKey,
      };
    });
  } catch {
    return [
      {
        brawlhallaId: selectedId,
        name: 'Unknown',
        region: '',
        rating: 0,
        tier: 'Unknown',
        games: 0,
        wins: 0,
      },
    ];
  }
}

/**
 * Purges expired search results from the in-memory cache.
 *
 * Removes any entries from `searchCache` whose stored timestamp is older than `CACHE_TTL`.
 */
function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}