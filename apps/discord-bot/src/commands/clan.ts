import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  Message,
  InteractionResponse,
} from 'discord.js';
import * as api from '../api/client.js';
import { buildClanEmbed, buildErrorEmbed } from '../utils/embeds.js';
import {
  buildClanSelectMenu,
  buildClanPaginationButtons,
} from '../utils/components.js';
import { pollForFreshData, setActiveTask } from '../utils/refresh.js';
import type { Command } from './index.js';

// Cache clan results for pagination (expires after 10 minutes)
const clanCache = new Map<
  string,
  { clan: api.ClanResponse; timestamp: number }
>();
const CLAN_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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

      // Cache the clan for pagination
      clanCache.set(interaction.id, {
        clan,
        timestamp: Date.now(),
      });
      cleanupCache();

      // Build response components
      const components: any[] = [];

      // Add pagination buttons if there are many members
      if (clan.members.length > 5) {
        components.push(
          buildClanPaginationButtons(interaction.id, 0, clan.members.length),
        );
      }

      // Add select menu if there are multiple search results
      if (searchResults.length > 1) {
        components.push(
          buildClanSelectMenu(searchResults, clanId, interaction.id),
        );
      }

      const reply = await interaction.editReply({
        embeds: [embed],
        components,
      });

      if (reply instanceof Message) {
        setActiveTask(reply.id, clanId);

        // If data is refreshing, start polling
        if (clan.isRefreshing) {
          void pollForFreshData(
            reply,
            clanId,
            'clan',
            searchResults,
            interaction.id,
          );
        }
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
 * Handle clan select menu interaction
 */
export async function handleClanSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const clanId = parseInt(interaction.values[0], 10);
  const interactionId = interaction.customId.split(':')[1];

  await interaction.deferUpdate();

  try {
    const clan = await api.getClan(clanId);
    const embed = buildClanEmbed(clan);

    // Cache the clan for pagination
    if (interactionId) {
      clanCache.set(interactionId, {
        clan,
        timestamp: Date.now(),
      });
      cleanupCache();
    }

    // Get cached search results to preserve the select menu
    const message = interaction.message;
    const components = message.components;
    setActiveTask(message.id, clanId);

    const responseComponents: any[] = [];

    // Add pagination buttons if there are many members
    if (clan.members.length > 5 && interactionId) {
      responseComponents.push(
        buildClanPaginationButtons(interactionId, 0, clan.members.length),
      );
    }

    // Update the select menu to show the new selection
    if (components.length > 0) {
      const clans = getClansFromMessage(message, clanId);
      const selectMenu = buildClanSelectMenu(clans, clanId, interactionId);
      responseComponents.push(selectMenu);
    }

    const reply = await interaction.editReply({
      embeds: [embed],
      components: responseComponents,
    });

    if (clan.isRefreshing && reply instanceof Message) {
      const clans = getClansFromMessage(message, clanId);
      void pollForFreshData(reply, clanId, 'clan', clans, interactionId);
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
 * Handle clan member pagination button interaction
 */
export async function handleClanPage(
  interaction: ButtonInteraction,
): Promise<void> {
  const [, interactionId, pageStr] = interaction.customId.split(':');
  const page = parseInt(pageStr, 10);

  const cached = clanCache.get(interactionId);
  if (!cached || Date.now() - cached.timestamp > CLAN_CACHE_TTL) {
    await interaction.reply({
      content: 'This interaction has expired. Please run the command again.',
      ephemeral: true,
    });
    return;
  }

  const { clan } = cached;
  const embed = buildClanEmbed(clan, page);

  // Update components (pagination buttons and preserved select menu)
  const components = interaction.message.components.map((row) => {
    const actionRow = row.toJSON();
    if ('components' in actionRow && actionRow.components[0]?.type === 2) {
      // Button (Pagination)
      return buildClanPaginationButtons(
        interactionId,
        page,
        clan.members.length,
      );
    }
    return row;
  });

  await interaction.update({
    embeds: [embed],
    components: components as any[],
  });
}

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of clanCache.entries()) {
    if (now - value.timestamp > CLAN_CACHE_TTL) {
      clanCache.delete(key);
    }
  }
}

/**
 * Extract clan options from the existing message's select menu
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
