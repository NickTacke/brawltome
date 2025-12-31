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
import { pollForFreshData, setActiveTask } from '../utils/refresh.js';
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
          buildPlayerSelectMenu(searchResults, playerId, interaction.id),
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

      if (reply instanceof Message) {
        setActiveTask(reply.id, playerId);

        // If data is refreshing, start polling
        if (player.isRefreshing) {
          void pollForFreshData(
            reply,
            playerId,
            'player',
            searchResults,
            interaction.id,
          );
        }
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
 * Handle player select menu interaction
 */
export async function handlePlayerSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const playerId = parseInt(interaction.values[0], 10);
  const interactionId = interaction.customId.split(':')[1];

  await interaction.deferUpdate();

  try {
    const player = await api.getPlayer(playerId);
    const embed = buildPlayerEmbed(player);

    let searchResults: api.SearchResponse['players'] | undefined;

    // Try to get from cache first
    if (interactionId) {
      const cached = searchCache.get(interactionId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        searchResults = cached.players;
      }
    }

    // Fallback to parsing message if not in cache or expired
    const message = interaction.message;
    if (!searchResults) {
      searchResults = getPlayersFromMessage(message, playerId);

      // Repopulate cache if we had an interaction ID
      if (interactionId && searchResults.length > 0) {
        searchCache.set(interactionId, {
          players: searchResults,
          timestamp: Date.now(),
        });

        // Clean up old cache entries
        cleanupCache();
      }
    }

    setActiveTask(message.id, playerId);

    // Update the select menu to show the new selection
    if (searchResults.length > 1) {
      const selectMenu = buildPlayerSelectMenu(
        searchResults,
        playerId,
        interactionId,
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
          searchResults,
          interactionId,
        );
      }
    } else {
      await interaction.editReply({
        embeds: [embed],
        components: [],
      });
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
 * Extract player options from the existing message's select menu
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

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      searchCache.delete(key);
    }
  }
}
