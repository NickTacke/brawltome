import type { ActionRowBuilder, EmbedBuilder, Message, StringSelectMenuBuilder } from 'discord.js'
import { api } from '../lib/trpc'
import type { SearchResponse } from '../lib/types'
import { buildClanSelectMenu, buildPlayerSelectMenu } from './components'
import { buildClanEmbed, buildPlayerEmbed } from './embeds'

const POLL_INTERVAL_MS = 5000 // 5 seconds
const MAX_POLL_ATTEMPTS = 3

// Track the current target ID for each message to prevent old polls from overwriting new selections
const activeTasks = new Map<string, number>()

/**
 * Sets the active target ID for a message. Any polling for a different ID will stop.
 */
export function setActiveTask(messageId: string, id: number): void {
  activeTasks.set(messageId, id)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type RefreshType = 'player' | 'clan'

interface RefreshableResponse {
  isRefreshing: boolean
}

/**
 * Polls the API until the data is no longer refreshing, then edits the message.
 * Gives up after MAX_POLL_ATTEMPTS tries.
 * Preserves select menu if search results are provided.
 */
export async function pollForFreshData(
  message: Message,
  id: number,
  type: RefreshType,
  searchResults?: SearchResponse['players'] | SearchResponse['clans'],
  interactionId?: string,
  attempt = 0,
): Promise<void> {
  // Check if this poll is still relevant
  if (activeTasks.get(message.id) !== id) {
    console.log(`[Refresh] Stopping poll for ${type} ${id} on message ${message.id} (no longer active)`)
    return
  }

  if (attempt >= MAX_POLL_ATTEMPTS) {
    console.log(`[Refresh] Gave up polling for ${type} ${id} after ${MAX_POLL_ATTEMPTS} attempts`)
    if (activeTasks.get(message.id) === id) {
      activeTasks.delete(message.id)
    }
    return
  }

  console.log(`[Refresh] Polling ${type} ${id} (attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS})`)

  await sleep(POLL_INTERVAL_MS)

  // Check again after sleep
  if (activeTasks.get(message.id) !== id) {
    return
  }

  try {
    let response: RefreshableResponse
    let embed: EmbedBuilder
    let components: ActionRowBuilder<StringSelectMenuBuilder>[] | undefined

    if (type === 'player') {
      const player = await api.player.byId.query({ id })
      if (!player) return
      response = player
      embed = buildPlayerEmbed(player)

      // Preserve select menu if we have search results
      if (searchResults && searchResults.length > 1) {
        components = [buildPlayerSelectMenu(searchResults as SearchResponse['players'], id, interactionId)]
      }
    } else {
      const clan = await api.clan.byId.query({ id })
      if (!clan) return
      response = clan
      embed = buildClanEmbed(clan)

      // Preserve select menu if we have search results
      if (searchResults && searchResults.length > 1) {
        components = [buildClanSelectMenu(searchResults as SearchResponse['clans'], id, interactionId)]
      }
    }

    // Final check before editing
    if (activeTasks.get(message.id) !== id) {
      return
    }

    if (!response.isRefreshing) {
      console.log(`[Refresh] ${type} ${id} data is now fresh, updating message`)
      await message.edit({
        embeds: [embed],
        components: components || [],
      })
      activeTasks.delete(message.id)
    } else {
      // Still refreshing, try again
      await pollForFreshData(message, id, type, searchResults, interactionId, attempt + 1)
    }
  } catch (error) {
    console.error(`[Refresh] Error polling ${type} ${id}:`, error)
    if (activeTasks.get(message.id) === id) {
      activeTasks.delete(message.id)
    }
    // Don't edit the message on error, just give up
  }
}
