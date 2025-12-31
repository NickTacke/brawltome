import { Message, EmbedBuilder } from 'discord.js';
import * as api from '../api/client.js';
import { buildPlayerEmbed, buildClanEmbed } from './embeds.js';
import { buildPlayerSelectMenu, buildClanSelectMenu } from './components.js';

const POLL_INTERVAL_MS = 5000; // 5 seconds
const MAX_POLL_ATTEMPTS = 3;

/**
 * Pauses execution for the specified duration.
 *
 * @param ms - The delay duration in milliseconds
 * @returns A promise that resolves to `void` after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type RefreshType = 'player' | 'clan';

interface RefreshableResponse {
  isRefreshing: boolean;
}

/**
 * Polls the API until the specified player or clan data is no longer refreshing and updates the Discord message with the resulting embed.
 *
 * If multiple search results are provided, preserves a select menu component when updating the message. Stops retrying after MAX_POLL_ATTEMPTS.
 *
 * @param id - The numeric identifier of the player or clan to poll
 * @param type - Either `'player'` or `'clan'`, indicating which resource to poll
 * @param searchResults - Optional search results used to build and preserve a select menu when more than one result exists
 * @param attempt - Current polling attempt count (used internally for retry limiting)
 */
export async function pollForFreshData(
  message: Message,
  id: number,
  type: RefreshType,
  searchResults?: api.SearchResponse['players'] | api.SearchResponse['clans'],
  attempt = 0,
): Promise<void> {
  if (attempt >= MAX_POLL_ATTEMPTS) {
    console.log(
      `[Refresh] Gave up polling for ${type} ${id} after ${MAX_POLL_ATTEMPTS} attempts`,
    );
    return;
  }

  console.log(
    `[Refresh] Polling ${type} ${id} (attempt ${
      attempt + 1
    }/${MAX_POLL_ATTEMPTS})`,
  );

  await sleep(POLL_INTERVAL_MS);

  try {
    let response: RefreshableResponse;
    let embed: EmbedBuilder;
    let components: ReturnType<typeof buildPlayerSelectMenu>[] | undefined;

    if (type === 'player') {
      const player = await api.getPlayer(id);
      response = player;
      embed = buildPlayerEmbed(player);

      // Preserve select menu if we have search results
      if (searchResults && searchResults.length > 1) {
        components = [
          buildPlayerSelectMenu(
            searchResults as api.SearchResponse['players'],
            id,
          ),
        ];
      }
    } else {
      const clan = await api.getClan(id);
      response = clan;
      embed = buildClanEmbed(clan);

      // Preserve select menu if we have search results
      if (searchResults && searchResults.length > 1) {
        components = [
          buildClanSelectMenu(searchResults as api.SearchResponse['clans'], id),
        ];
      }
    }

    if (!response.isRefreshing) {
      console.log(
        `[Refresh] ${type} ${id} data is now fresh, updating message`,
      );
      await message.edit({
        embeds: [embed],
        components: components || [],
      });
    } else {
      // Still refreshing, try again
      await pollForFreshData(message, id, type, searchResults, attempt + 1);
    }
  } catch (error) {
    console.error(`[Refresh] Error polling ${type} ${id}:`, error);
    // Don't edit the message on error, just give up
  }
}