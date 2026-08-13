import { TRPCClientError } from '@trpc/client'
import {
  type ChatInputCommandInteraction,
  type InteractionResponse,
  type Message,
  SlashCommandBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js'
import { runBeforeInteractionDeadline } from '../interaction-deadline'
import { handleExpiredInteractionError, runInteractionResponse } from '../interaction-response'
import { discordTelemetry } from '../lib/telemetry'
import { api } from '../lib/trpc'
import type { CanonicalPlayerResponse, PlayerRefreshResponse, SearchResponse } from '../lib/types'
import { buildPlayerSelectMenu } from '../utils/components'
import { buildCanonicalPlayerEmbed, buildErrorEmbed } from '../utils/embeds'
import { escapeDiscordText } from '../utils/text'
import type { Command } from './index'

// Cache search results for select menu interactions (expires after 5 minutes)
const searchCache = new Map<string, { players: SearchResponse['players']; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const DEFAULT_POLL_LIMIT = 4
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const INTERACTION_WORK_BUDGET_MS = 14 * 60 * 1_000

interface PlayerCommandDependencies {
  client?: typeof api
  wait?: (milliseconds: number) => Promise<void>
  now?: () => number
  pollLimit?: number
  requestTimeoutMs?: number
  workBudgetMs?: number
}

async function pollPlayerUntilSectionsComplete(
  initial: CanonicalPlayerResponse,
  afterSeconds: number,
  client: typeof api,
  wait: (milliseconds: number) => Promise<void>,
  now: () => number,
  deadline: number,
  requestTimeoutMs: number,
  limit: number,
): Promise<CanonicalPlayerResponse> {
  let player = initial
  let rankedPending = initial.currentSeason?.freshness !== 'fresh'
  let careerPending = initial.career?.freshness !== 'fresh'
  const rankedBaseline = initial.currentSeason?.lastSuccessAt ?? null
  const careerBaseline = initial.career?.lastSuccessAt ?? null

  for (let attempt = 0; attempt < limit && (rankedPending || careerPending); attempt += 1) {
    const delayMs = afterSeconds * 1_000
    if (!Number.isFinite(delayMs) || delayMs < 0 || now() + delayMs >= deadline) break
    await wait(delayMs)
    try {
      const [currentSeason, career] = await Promise.all([
        rankedPending
          ? runBeforeInteractionDeadline({
              deadline,
              requestTimeoutMs,
              now,
              work: (signal) => client.player.rankedById.query({ id: player.reference.brawlhallaId }, { signal }),
            })
          : Promise.resolve(player.currentSeason),
        careerPending
          ? runBeforeInteractionDeadline({
              deadline,
              requestTimeoutMs,
              now,
              work: (signal) => client.player.careerById.query({ id: player.reference.brawlhallaId }, { signal }),
            })
          : Promise.resolve(player.career),
      ])
      player = { ...player, currentSeason, career }
      rankedPending = rankedPending && (!currentSeason?.lastSuccessAt || currentSeason.lastSuccessAt === rankedBaseline)
      careerPending = careerPending && (!career?.lastSuccessAt || career.lastSuccessAt === careerBaseline)
    } catch {
      break
    }
  }
  return player
}

async function loadCanonicalPlayer(
  playerId: number,
  discordUserId: string,
  client: typeof api,
  wait: (milliseconds: number) => Promise<void>,
  now: () => number,
  pollLimit: number,
  requestTimeoutMs: number,
  deadline: number,
): Promise<{ player: CanonicalPlayerResponse | null; refresh: PlayerRefreshResponse['refresh'] }> {
  const request = <T>(work: (signal: AbortSignal) => Promise<T>) =>
    runBeforeInteractionDeadline({ deadline, requestTimeoutMs, now, work })
  const [reference, currentSeason, career] = await Promise.all([
    request((signal) => client.player.referenceById.query({ id: playerId }, { signal })),
    request((signal) => client.player.rankedById.query({ id: playerId }, { signal })),
    request((signal) => client.player.careerById.query({ id: playerId }, { signal })),
  ])
  let refreshResponse: PlayerRefreshResponse
  try {
    refreshResponse = await request((signal) =>
      client.player.refreshDiscord.mutate({ id: playerId, discordUserId }, { signal }),
    )
  } catch (error) {
    discordTelemetry.logger.error('discord.player_refresh.failed', error)
    refreshResponse = {
      player: reference,
      refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
    }
  }
  const canonicalReference = reference ?? refreshResponse.player
  if (!canonicalReference) return { player: null, refresh: refreshResponse.refresh }

  let player: CanonicalPlayerResponse = { reference: canonicalReference, currentSeason, career }
  if (refreshResponse.refresh.retry.kind === 'poll') {
    player = await pollPlayerUntilSectionsComplete(
      player,
      refreshResponse.refresh.retry.afterSeconds,
      client,
      wait,
      now,
      deadline,
      requestTimeoutMs,
      pollLimit,
    )
  }
  return { player, refresh: refreshResponse.refresh }
}

export function createPlayerCommand({
  client = api,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  pollLimit = DEFAULT_POLL_LIMIT,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  workBudgetMs = INTERACTION_WORK_BUDGET_MS,
}: PlayerCommandDependencies = {}): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('player')
      .setDescription('Look up a Brawlhalla player')
      .addStringOption((option) =>
        option.setName('query').setDescription('Player name or Brawlhalla ID').setRequired(true),
      ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const query = interaction.options.getString('query', true).trim()

      if (!(await runInteractionResponse(() => interaction.deferReply(), 'discord.player_acknowledgement.expired'))) {
        return
      }

      const deadline = now() + workBudgetMs
      try {
        // Check if query is a numeric ID
        const numericId = Number.parseInt(query, 10)
        const isNumericId = !Number.isNaN(numericId) && query === numericId.toString()

        let playerId: number
        let searchResults: SearchResponse['players'] = []

        if (isNumericId) {
          // Direct ID lookup
          playerId = numericId
        } else {
          // Search by name
          const results = await runBeforeInteractionDeadline({
            deadline,
            requestTimeoutMs,
            now,
            work: (signal) => client.search.local.query({ query }, { signal }),
          })
          searchResults = results.players

          if (searchResults.length === 0) {
            await interaction.editReply({
              embeds: [
                buildErrorEmbed(
                  'Player Not Found',
                  `No players found matching "${escapeDiscordText(query)}". Try searching with a Brawlhalla ID instead.`,
                ),
              ],
            })
            return
          }

          // Discovery owns canonical result ordering.
          playerId = searchResults[0].brawlhallaId
        }

        const loaded = await loadCanonicalPlayer(
          playerId,
          interaction.user.id,
          client,
          wait,
          now,
          pollLimit,
          requestTimeoutMs,
          deadline,
        )

        if (!loaded.player) {
          const temporarilyUnavailable =
            loaded.refresh.outcome === 'temporarilyUnavailable' ||
            loaded.refresh.outcome === 'rateLimited' ||
            loaded.refresh.outcome === 'accepted' ||
            loaded.refresh.outcome === 'alreadyRefreshing'
          await interaction.editReply({
            embeds: [
              temporarilyUnavailable
                ? buildErrorEmbed('Player Unavailable', 'Player data is unavailable. Try again later.')
                : buildErrorEmbed(
                    'Player Not Found',
                    `Could not find a player with that ID. Make sure you're using a valid Brawlhalla ID.`,
                  ),
            ],
          })
          return
        }

        const embed = buildCanonicalPlayerEmbed(loaded.player, loaded.refresh, now())

        const responseOptions: {
          embeds: ReturnType<typeof buildCanonicalPlayerEmbed>[]
          components?: ReturnType<typeof buildPlayerSelectMenu>[]
        } = { embeds: [embed] }

        // Add select menu if there are multiple search results
        if (searchResults.length > 1) {
          responseOptions.components = [buildPlayerSelectMenu(searchResults, playerId, interaction.id)]

          // Cache the search results for select menu interactions
          const cacheKey = interaction.id
          searchCache.set(cacheKey, {
            players: searchResults,
            timestamp: Date.now(),
          })

          // Clean up old cache entries
          cleanupCache()
        }

        await interaction.editReply(responseOptions)
      } catch (error) {
        if (handleExpiredInteractionError(error, 'discord.player_response.expired')) return
        discordTelemetry.logger.error('discord.player_command.failed', error)

        if (error instanceof TRPCClientError) {
          if (error.data?.httpStatus === 404) {
            await runInteractionResponse(
              () =>
                interaction.editReply({
                  embeds: [
                    buildErrorEmbed(
                      'Player Not Found',
                      `Could not find a player with that ID. Make sure you're using a valid Brawlhalla ID.`,
                    ),
                  ],
                }),
              'discord.player_error_response.expired',
            )
            return
          }

          if (error.data?.httpStatus === 429) {
            await runInteractionResponse(
              () =>
                interaction.editReply({
                  embeds: [
                    buildErrorEmbed('Rate Limited', 'The API is currently busy. Please try again in a few minutes.'),
                  ],
                }),
              'discord.player_error_response.expired',
            )
            return
          }
        }

        await runInteractionResponse(
          () =>
            interaction.editReply({
              embeds: [
                buildErrorEmbed('Error', 'Something went wrong while fetching player data. Please try again later.'),
              ],
            }),
          'discord.player_error_response.expired',
        )
      }
    },
  }
}

export const playerCommand = createPlayerCommand()

export function createPlayerSelectHandler({
  client = api,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = Date.now,
  pollLimit = DEFAULT_POLL_LIMIT,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  workBudgetMs = INTERACTION_WORK_BUDGET_MS,
}: PlayerCommandDependencies = {}) {
  return async function playerSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const playerId = Number.parseInt(interaction.values[0], 10)
    const interactionId = interaction.customId.split(':')[1]
    if (
      !(await runInteractionResponse(() => interaction.deferUpdate(), 'discord.player_select_acknowledgement.expired'))
    ) {
      return
    }

    const deadline = now() + workBudgetMs
    try {
      const loaded = await loadCanonicalPlayer(
        playerId,
        interaction.user.id,
        client,
        wait,
        now,
        pollLimit,
        requestTimeoutMs,
        deadline,
      )
      if (!loaded.player) {
        await runInteractionResponse(
          () =>
            interaction.editReply({
              embeds: [buildErrorEmbed('Player Unavailable', 'Player data is unavailable. Try again later.')],
              components: [],
            }),
          'discord.player_select_response.expired',
        )
        return
      }
      const embed = buildCanonicalPlayerEmbed(loaded.player, loaded.refresh, now())
      let searchResults: SearchResponse['players'] | undefined

      if (interactionId) {
        const cached = searchCache.get(interactionId)
        if (cached && now() - cached.timestamp < CACHE_TTL) searchResults = cached.players
      }
      if (!searchResults) {
        searchResults = getPlayersFromMessage(interaction.message, playerId)
        if (interactionId && searchResults.length > 0) {
          searchCache.set(interactionId, { players: searchResults, timestamp: now() })
          cleanupCache()
        }
      }

      const components = searchResults.length > 1 ? [buildPlayerSelectMenu(searchResults, playerId, interactionId)] : []
      await interaction.editReply({ embeds: [embed], components })
    } catch (error) {
      if (handleExpiredInteractionError(error, 'discord.player_select_response.expired')) return
      discordTelemetry.logger.error('discord.player_select.failed', error)
      await runInteractionResponse(
        () =>
          interaction.editReply({
            embeds: [buildErrorEmbed('Error', 'Something went wrong while fetching player data.')],
            components: [],
          }),
        'discord.player_select_error_response.expired',
      )
    }
  }
}

export const handlePlayerSelect = createPlayerSelectHandler()

function getPlayersFromMessage(
  message: Message<boolean> | InteractionResponse<boolean>,
  selectedId: number,
): SearchResponse['players'] {
  try {
    if (!('components' in message)) return []
    const row = message.components[0]
    if (!row || !('components' in row)) return []

    const select = row.components[0]
    if (!select || select.type !== 3) return [] // 3 = StringSelect

    interface SelectOption {
      label: string
      value: string
      description?: string
      emoji?: { name?: string }
    }

    const options: SelectOption[] = 'data' in select ? (select.data as { options?: SelectOption[] }).options || [] : []

    return options.map((opt) => {
      const desc = opt.description || ''
      const ratingValue = Number.parseInt(desc.split(' • ')[0], 10)
      const rating = Number.isNaN(ratingValue) ? null : ratingValue

      // Extract legend name from emoji (e.g., "avatar_bodvar" -> "bodvar")
      let bestLegendNameKey: string | null = null
      if (opt.emoji?.name?.startsWith('avatar_')) {
        bestLegendNameKey = opt.emoji.name.replace('avatar_', '')
      }

      return {
        brawlhallaId: Number.parseInt(opt.value, 10),
        name: opt.label,
        region: '' as string | null,
        rating,
        viewCount: 0,
        bestLegendNameKey,
        matchedAlias: null,
      }
    }) as SearchResponse['players']
  } catch {
    return [
      {
        brawlhallaId: selectedId,
        name: 'Unknown',
        region: '' as string | null,
        rating: null,
        viewCount: 0,
        bestLegendNameKey: null,
        matchedAlias: null,
      },
    ] as SearchResponse['players']
  }
}

function cleanupCache() {
  const now = Date.now()
  for (const [key, value] of searchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      searchCache.delete(key)
    }
  }
}
