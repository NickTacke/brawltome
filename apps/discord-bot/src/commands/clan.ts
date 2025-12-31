import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  Message,
  InteractionResponse,
} from 'discord.js';
import * as api from '../api/client.js';
import { buildClanEmbed, buildErrorEmbed } from '../utils/embeds.js';
import { buildClanSelectMenu } from '../utils/components.js';
import { pollForFreshData } from '../utils/refresh.js';
import type { Command } from './index.js';

export const clanCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('clan')
    .setDescription('Look up a Brawlhalla clan')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('Clan name or clan ID')
        .setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query', true).trim();

    await interaction.deferReply();

    try {
      // Check if query is a numeric ID
      const numericId = parseInt(query, 10);
      const isNumericId = !isNaN(numericId) && query === numericId.toString();

      let clanId: number;
      let searchResults: api.SearchResponse['clans'] = [];

      if (isNumericId) {
        // Direct ID lookup
        clanId = numericId;
      } else {
        // Search by name
        const results = await api.search(query);
        searchResults = results.clans;

        if (searchResults.length === 0) {
          await interaction.editReply({
            embeds: [
              buildErrorEmbed(
                'Clan Not Found',
                `No clans found matching "${query}". Try searching with a clan ID instead.`,
              ),
            ],
          });
          return;
        }

        // Use the best result (first one)
        clanId = searchResults[0].clanId;
      }

      // Fetch clan data
      const clan = await api.getClan(clanId);
      const embed = buildClanEmbed(clan);

      // Build response with optional select menu
      const responseOptions: {
        embeds: ReturnType<typeof buildClanEmbed>[];
        components?: ReturnType<typeof buildClanSelectMenu>[];
      } = { embeds: [embed] };

      // Add select menu if there are multiple search results
      if (searchResults.length > 1) {
        responseOptions.components = [
          buildClanSelectMenu(searchResults, clanId),
        ];
      }

      const reply = await interaction.editReply(responseOptions);

      // If data is refreshing, start polling
      if (clan.isRefreshing && reply instanceof Message) {
        void pollForFreshData(reply, clanId, 'clan', searchResults);
      }
    } catch (error) {
      console.error('[Clan Command] Error:', error);

      if (error instanceof api.ApiError) {
        if (error.status === 404) {
          await interaction.editReply({
            embeds: [
              buildErrorEmbed(
                'Clan Not Found',
                `Could not find a clan with that ID. Make sure you're using a valid clan ID.`,
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
            'Something went wrong while fetching clan data. Please try again later.',
          ),
        ],
      });
    }
  },
};

/**
 * Update the original select-menu message to show details for the selected clan.
 *
 * Fetches the clan corresponding to the user's selection, replaces the message embed with the clan's embed, preserves and updates the select menu to reflect the new selection, and starts background polling for fresh data if the clan is marked as refreshing.
 *
 * @param interaction - The select-menu interaction containing the chosen clan id and the message to update
 */
export async function handleClanSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const clanId = parseInt(interaction.values[0], 10);

  await interaction.deferUpdate();

  try {
    const clan = await api.getClan(clanId);
    const embed = buildClanEmbed(clan);

    // Get cached search results to preserve the select menu
    const message = interaction.message;
    const components = message.components;

    // Update the select menu to show the new selection
    if (components.length > 0) {
      const clans = getClansFromMessage(message, clanId);
      const selectMenu = buildClanSelectMenu(clans, clanId);

      const reply = await interaction.editReply({
        embeds: [embed],
        components: [selectMenu],
      });

      if (clan.isRefreshing && reply instanceof Message) {
        void pollForFreshData(reply, clanId, 'clan', clans);
      }
    } else {
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error('[Clan Select] Error:', error);
    await interaction.editReply({
      embeds: [
        buildErrorEmbed(
          'Error',
          'Something went wrong while fetching clan data.',
        ),
      ],
      components: [],
    });
  }
}

/**
 * Extract available clan options from a message's select menu.
 *
 * Parses the first action row's string-select component and maps each option to
 * an object shaped like entries in `api.SearchResponse['clans']`. If no suitable
 * select menu or options are present, returns an empty array. If an unexpected
 * error occurs while parsing, returns a single-item fallback array containing
 * an "Unknown" clan using `selectedId`.
 *
 * @param message - The message or interaction response containing components to read
 * @param selectedId - Clan ID to use in the fallback entry if parsing fails with an exception
 * @returns An array of clan-like objects with `clanId`, `name`, `xp` (`'0'`), and `memberCount` — empty when no select/options are found, or a single fallback entry on error
 */
function getClansFromMessage(
  message: Message<boolean> | InteractionResponse<boolean>,
  selectedId: number,
): api.SearchResponse['clans'] {
  try {
    if (!('components' in message)) return [];
    const row = message.components[0];
    if (!row || !('components' in row)) return [];

    const select = row.components[0];
    if (!select || select.type !== 3) return []; // 3 = StringSelect

    const options =
      'data' in select
        ? (
            select.data as {
              options?: Array<{
                label: string;
                value: string;
                description?: string;
              }>;
            }
          ).options || []
        : [];

    return options.map((opt) => ({
      clanId: parseInt(opt.value, 10),
      name: opt.label,
      xp: '0',
      memberCount: parseInt(opt.description?.split(' ')[0] || '0', 10),
    }));
  } catch {
    return [{ clanId: selectedId, name: 'Unknown', xp: '0', memberCount: 0 }];
  }
}