import { TRPCClientError } from '@trpc/client'
import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionResponse,
  type Message,
  SlashCommandBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js'
import { discordTelemetry } from '../lib/telemetry'
import { api } from '../lib/trpc'
import type { ClanResponse, SearchResponse } from '../lib/types'
import { buildClanPaginationButtons, buildClanSelectMenu } from '../utils/components'
import { buildClanEmbed, buildErrorEmbed } from '../utils/embeds'
import type { Command } from './index'

// Cache clan results for pagination (expires after 10 minutes)
const clanCache = new Map<string, { clan: ClanResponse; timestamp: number }>()
const CLAN_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

const CLAN_FRESH_MS = 60 * 60 * 1_000
const DISCORD_POLL_LIMIT = 4

function stale(lastSuccessAt: string | null | undefined, now = Date.now()): boolean {
  return !lastSuccessAt || now - new Date(lastSuccessAt).getTime() > CLAN_FRESH_MS
}

export async function pollClanUntilSectionsComplete(
  initialClan: ClanResponse | null,
  afterSeconds: number,
  query: () => Promise<ClanResponse | null>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  limit = DISCORD_POLL_LIMIT,
): Promise<ClanResponse | null> {
  let clan = initialClan
  const pending = {
    profile: stale(clan?.profile.lastSuccessAt),
    roster: stale(clan?.roster?.lastSuccessAt),
  }
  const initial = {
    profile: clan?.profile.lastSuccessAt ?? null,
    roster: clan?.roster?.lastSuccessAt ?? null,
  }
  for (let attempt = 0; attempt < limit; attempt += 1) {
    await wait(afterSeconds * 1_000)
    clan = await query()
    if (
      clan &&
      (!pending.profile || clan.profile.lastSuccessAt !== initial.profile) &&
      (!pending.roster || clan.roster?.lastSuccessAt !== initial.roster)
    ) {
      break
    }
  }
  return clan
}

async function fetchClan(clanId: number, discordUserId: string) {
  const response = await api.clan.refreshDiscord.mutate({ id: clanId, discordUserId })
  let clan = response.clan
  const retry = response.refresh.retry
  if (
    (response.refresh.outcome === 'accepted' || response.refresh.outcome === 'alreadyRefreshing') &&
    retry.kind === 'poll'
  ) {
    clan = await pollClanUntilSectionsComplete(clan, retry.afterSeconds, () => api.clan.byId.query({ id: clanId }))
  }
  return { clan: clan ?? (await api.clan.byId.query({ id: clanId })), refresh: response.refresh }
}

export const clanCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('clan')
    .setDescription('Look up a Brawlhalla clan')
    .addStringOption((option) =>
      option.setName('query').setDescription('Clan name or clan ID').setRequired(true),
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query', true).trim()

    await interaction.deferReply()

    try {
      // Check if query is a numeric ID
      const numericId = Number.parseInt(query, 10)
      const isNumericId = !Number.isNaN(numericId) && query === numericId.toString()

      let clanId: number
      let searchResults: SearchResponse['clans'] = []

      if (isNumericId) {
        // Direct ID lookup
        clanId = numericId
      } else {
        // Search by name
        const results = await api.search.local.query({ query })
        searchResults = results.clans

        if (searchResults.length === 0) {
          await interaction.editReply({
            embeds: [
              buildErrorEmbed(
                'Clan Not Found',
                `No clans found matching "${query}". Try searching with a clan ID instead.`,
              ),
            ],
          })
          return
        }

        // Use the best result (first one)
        clanId = searchResults[0].clanId
      }

      const { clan, refresh } = await fetchClan(clanId, interaction.user.id)

      if (!clan) {
        await interaction.editReply({
          embeds: [
            refresh.outcome === 'rateLimited'
              ? buildErrorEmbed('Rate Limited', 'Clan data is cached when available. Try again later.')
              : buildErrorEmbed('Clan Unavailable', 'Clan data could not be verified. Try again later.'),
          ],
        })
        return
      }

      const embed = buildClanEmbed(clan)

      // Cache the clan for pagination
      clanCache.set(interaction.id, {
        clan,
        timestamp: Date.now(),
      })
      cleanupCache()

      // biome-ignore lint/suspicious/noExplicitAny: mixed component row types from discord.js
      const components: any[] = []

      // Add pagination buttons if there are many members
      if (clan.members.length > 5) {
        components.push(buildClanPaginationButtons(interaction.id, 0, clan.members.length))
      }

      // Add select menu if there are multiple search results
      if (searchResults.length > 1) {
        const clanOptions = searchResults.map((c: SearchResponse['clans'][number]) => ({
          clanId: c.clanId,
          clanName: c.clanName,
          memberCount: 0,
        }))
        components.push(buildClanSelectMenu(clanOptions, clanId, interaction.id))
      }

      const reply = await interaction.editReply({
        embeds: [embed],
        components,
      })
    } catch (error) {
      discordTelemetry.logger.error('discord.clan_command.failed', error)

      if (error instanceof TRPCClientError) {
        if (error.data?.httpStatus === 404) {
          await interaction.editReply({
            embeds: [
              buildErrorEmbed(
                'Clan Not Found',
                `Could not find a clan with that ID. Make sure you're using a valid clan ID.`,
              ),
            ],
          })
          return
        }

        if (error.data?.httpStatus === 429) {
          await interaction.editReply({
            embeds: [buildErrorEmbed('Rate Limited', 'The API is currently busy. Please try again in a few minutes.')],
          })
          return
        }
      }

      await interaction.editReply({
        embeds: [buildErrorEmbed('Error', 'Something went wrong while fetching clan data. Please try again later.')],
      })
    }
  },
}

export async function handleClanSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const clanId = Number.parseInt(interaction.values[0], 10)
  const interactionId = interaction.customId.split(':')[1]

  await interaction.deferUpdate()

  try {
    const { clan } = await fetchClan(clanId, interaction.user.id)

    if (!clan) {
      await interaction.editReply({
        embeds: [buildErrorEmbed('Clan Unavailable', 'Clan data could not be verified. Try again later.')],
        components: [],
      })
      return
    }

    const embed = buildClanEmbed(clan)

    // Cache the clan for pagination
    if (interactionId) {
      clanCache.set(interactionId, {
        clan,
        timestamp: Date.now(),
      })
      cleanupCache()
    }

    // Get cached search results to preserve the select menu
    const message = interaction.message
    const components = message.components
    // biome-ignore lint/suspicious/noExplicitAny: mixed component row types from discord.js
    const responseComponents: any[] = []

    // Add pagination buttons if there are many members
    if (clan.members.length > 5 && interactionId) {
      responseComponents.push(buildClanPaginationButtons(interactionId, 0, clan.members.length))
    }

    // Update the select menu to show the new selection
    if (components.length > 0) {
      const clans = getClansFromMessage(message, clanId)
      const selectMenu = buildClanSelectMenu(clans, clanId, interactionId)
      responseComponents.push(selectMenu)
    }

    const reply = await interaction.editReply({
      embeds: [embed],
      components: responseComponents,
    })
  } catch (error) {
    discordTelemetry.logger.error('discord.clan_select.failed', error)
    await interaction.editReply({
      embeds: [buildErrorEmbed('Error', 'Something went wrong while fetching clan data.')],
      components: [],
    })
  }
}

export async function handleClanPage(interaction: ButtonInteraction): Promise<void> {
  const [, interactionId, pageStr] = interaction.customId.split(':')
  const page = Number.parseInt(pageStr, 10)

  const cached = clanCache.get(interactionId)
  if (!cached || Date.now() - cached.timestamp > CLAN_CACHE_TTL) {
    await interaction.reply({
      content: 'This interaction has expired. Please run the command again.',
      ephemeral: true,
    })
    return
  }

  const { clan } = cached
  const embed = buildClanEmbed(clan, page)

  // Update components (pagination buttons and preserved select menu)
  const components = interaction.message.components.map((row) => {
    const actionRow = row.toJSON()
    if ('components' in actionRow && actionRow.components[0]?.type === 2) {
      // Button (Pagination)
      return buildClanPaginationButtons(interactionId, page, clan.members.length)
    }
    return row
  })

  await interaction.update({
    embeds: [embed],
    // biome-ignore lint/suspicious/noExplicitAny: mixed component row types from discord.js
    components: components as any[],
  })
}

function cleanupCache() {
  const now = Date.now()
  for (const [key, value] of clanCache.entries()) {
    if (now - value.timestamp > CLAN_CACHE_TTL) {
      clanCache.delete(key)
    }
  }
}

function getClansFromMessage(
  message: Message<boolean> | InteractionResponse<boolean>,
  selectedId: number,
): Array<{ clanId: number; clanName: string; memberCount: number }> {
  try {
    if (!('components' in message)) return []
    const row = message.components[0]
    if (!row || !('components' in row)) return []

    const select = row.components[0]
    if (!select || select.type !== 3) return [] // 3 = StringSelect

    const options =
      'data' in select
        ? (
            select.data as {
              options?: Array<{
                label: string
                value: string
                description?: string
              }>
            }
          ).options || []
        : []

    return options.map((opt) => ({
      clanId: Number.parseInt(opt.value, 10),
      clanName: opt.label,
      memberCount: Number.parseInt(opt.description?.split(' ')[0] || '0', 10),
    }))
  } catch {
    return [{ clanId: selectedId, clanName: 'Unknown', memberCount: 0 }]
  }
}
