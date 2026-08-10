import { TRPCClientError } from '@trpc/client'
import {
  type ButtonInteraction,
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
import type { ClanRefreshResponse, ClanResponse, SearchResponse } from '../lib/types'
import { buildClanPaginationButtons, buildClanSelectMenu } from '../utils/components'
import { buildClanEmbed, buildErrorEmbed } from '../utils/embeds'
import { escapeDiscordText } from '../utils/text'
import type { Command } from './index'

// Cache clan results for pagination (expires after 10 minutes)
const clanCache = new Map<string, { clan: ClanResponse; timestamp: number }>()
const CLAN_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

const CLAN_FRESH_MS = 60 * 60 * 1_000
const DISCORD_POLL_LIMIT = 4
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const INTERACTION_WORK_BUDGET_MS = 14 * 60 * 1_000

interface ClanCommandDependencies {
  client?: typeof api
  wait?: (milliseconds: number) => Promise<void>
  now?: () => number
  pollLimit?: number
  requestTimeoutMs?: number
  workBudgetMs?: number
}

function stale(lastSuccessAt: string | null | undefined, now = Date.now()): boolean {
  return !lastSuccessAt || now - new Date(lastSuccessAt).getTime() > CLAN_FRESH_MS
}

export async function pollClanUntilSectionsComplete(
  initialClan: ClanResponse | null,
  afterSeconds: number,
  query: (signal?: AbortSignal) => Promise<ClanResponse | null>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  limit = DISCORD_POLL_LIMIT,
  now: () => number = Date.now,
  deadline = now() + INTERACTION_WORK_BUDGET_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<ClanResponse | null> {
  let clan = initialClan
  const pending = {
    profile: stale(clan?.profile.lastSuccessAt, now()),
    roster: stale(clan?.roster?.lastSuccessAt, now()),
  }
  const initial = {
    profile: clan?.profile.lastSuccessAt ?? null,
    roster: clan?.roster?.lastSuccessAt ?? null,
  }
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const delayMs = afterSeconds * 1_000
    if (!Number.isFinite(delayMs) || delayMs < 0 || now() + delayMs >= deadline) break
    await wait(delayMs)
    try {
      clan = await runBeforeInteractionDeadline({
        deadline,
        requestTimeoutMs,
        now,
        work: (signal) => query(signal),
      })
    } catch {
      break
    }
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

async function fetchClan(
  clanId: number,
  discordUserId: string,
  {
    client = api,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now = Date.now,
    pollLimit = DISCORD_POLL_LIMIT,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    workBudgetMs = INTERACTION_WORK_BUDGET_MS,
  }: ClanCommandDependencies = {},
  deadline = now() + workBudgetMs,
) {
  const request = <T>(work: (signal: AbortSignal) => Promise<T>) =>
    runBeforeInteractionDeadline({ deadline, requestTimeoutMs, now, work })
  let response: ClanRefreshResponse
  try {
    response = await request((signal) => client.clan.refreshDiscord.mutate({ id: clanId, discordUserId }, { signal }))
  } catch (error) {
    discordTelemetry.logger.error('discord.clan_refresh.failed', error)
    const clan = await request((signal) => client.clan.byId.query({ id: clanId }, { signal }))
    return {
      clan,
      refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } } as const,
    }
  }
  let clan = response.clan
  const retry = response.refresh.retry
  if (retry.kind === 'poll') {
    clan = await pollClanUntilSectionsComplete(
      clan,
      retry.afterSeconds,
      (signal) => client.clan.byId.query({ id: clanId }, { signal }),
      wait,
      pollLimit,
      now,
      deadline,
      requestTimeoutMs,
    )
  }
  return {
    clan: clan ?? (await request((signal) => client.clan.byId.query({ id: clanId }, { signal }))),
    refresh: response.refresh,
  }
}

export function createClanCommand(dependencies: ClanCommandDependencies = {}): Command {
  const {
    client = api,
    now = Date.now,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    workBudgetMs = INTERACTION_WORK_BUDGET_MS,
  } = dependencies
  return {
    data: new SlashCommandBuilder()
      .setName('clan')
      .setDescription('Look up a Brawlhalla clan')
      .addStringOption((option) =>
        option.setName('query').setDescription('Clan name or clan ID').setRequired(true),
      ) as SlashCommandBuilder,

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      const query = interaction.options.getString('query', true).trim()

      if (!(await runInteractionResponse(() => interaction.deferReply(), 'discord.clan_acknowledgement.expired'))) {
        return
      }

      const deadline = now() + workBudgetMs
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
          const results = await runBeforeInteractionDeadline({
            deadline,
            requestTimeoutMs,
            now,
            work: (signal) => client.search.local.query({ query }, { signal }),
          })
          searchResults = results.clans

          if (searchResults.length === 0) {
            await interaction.editReply({
              embeds: [
                buildErrorEmbed(
                  'Clan Not Found',
                  `No clans found matching "${escapeDiscordText(query)}". Try searching with a clan ID instead.`,
                ),
              ],
            })
            return
          }

          // Use the best result (first one)
          clanId = searchResults[0].clanId
        }

        const { clan, refresh } = await fetchClan(clanId, interaction.user.id, dependencies, deadline)

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

        const embed = buildClanEmbed(clan, 0, refresh, now())

        // Cache the clan for pagination
        clanCache.set(interaction.id, {
          clan,
          timestamp: Date.now(),
        })
        cleanupCache()

        // biome-ignore lint/suspicious/noExplicitAny: mixed component row types from discord.js
        const components: any[] = []

        // Add pagination buttons if there are many members
        if (clan.roster?.lastSuccessAt && clan.members.length > 5) {
          components.push(buildClanPaginationButtons(interaction.id, 0, clan.members.length))
        }

        // Add select menu if there are multiple search results
        if (searchResults.length > 1) {
          const clanOptions = searchResults.map((c: SearchResponse['clans'][number]) => ({
            clanId: c.clanId,
            clanName: c.clanName,
            memberCount: c.memberCount,
          }))
          components.push(buildClanSelectMenu(clanOptions, clanId, interaction.id))
        }

        await interaction.editReply({
          embeds: [embed],
          components,
        })
      } catch (error) {
        if (handleExpiredInteractionError(error, 'discord.clan_response.expired')) return
        discordTelemetry.logger.error('discord.clan_command.failed', error)

        if (error instanceof TRPCClientError) {
          if (error.data?.httpStatus === 404) {
            await runInteractionResponse(
              () =>
                interaction.editReply({
                  embeds: [
                    buildErrorEmbed(
                      'Clan Not Found',
                      `Could not find a clan with that ID. Make sure you're using a valid clan ID.`,
                    ),
                  ],
                }),
              'discord.clan_error_response.expired',
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
              'discord.clan_error_response.expired',
            )
            return
          }
        }

        await runInteractionResponse(
          () =>
            interaction.editReply({
              embeds: [
                buildErrorEmbed('Error', 'Something went wrong while fetching clan data. Please try again later.'),
              ],
            }),
          'discord.clan_error_response.expired',
        )
      }
    },
  }
}

export const clanCommand = createClanCommand()

export function createClanSelectHandler(dependencies: ClanCommandDependencies = {}) {
  const { now = Date.now, workBudgetMs = INTERACTION_WORK_BUDGET_MS } = dependencies
  return async function clanSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const clanId = Number.parseInt(interaction.values[0], 10)
    const interactionId = interaction.customId.split(':')[1]
    if (
      !(await runInteractionResponse(() => interaction.deferUpdate(), 'discord.clan_select_acknowledgement.expired'))
    ) {
      return
    }

    const deadline = now() + workBudgetMs
    try {
      const { clan, refresh } = await fetchClan(clanId, interaction.user.id, dependencies, deadline)
      if (!clan) {
        await runInteractionResponse(
          () =>
            interaction.editReply({
              embeds: [buildErrorEmbed('Clan Unavailable', 'Clan data could not be verified. Try again later.')],
              components: [],
            }),
          'discord.clan_select_response.expired',
        )
        return
      }
      const embed = buildClanEmbed(clan, 0, refresh, now())
      if (interactionId) {
        clanCache.set(interactionId, { clan, timestamp: now() })
        cleanupCache()
      }

      // biome-ignore lint/suspicious/noExplicitAny: mixed component row types from discord.js
      const responseComponents: any[] = []
      if (clan.roster?.lastSuccessAt && clan.members.length > 5 && interactionId) {
        responseComponents.push(buildClanPaginationButtons(interactionId, 0, clan.members.length))
      }
      if (interaction.message.components.length > 0) {
        const clans = getClansFromMessage(interaction.message)
        if (clans.length > 0) responseComponents.push(buildClanSelectMenu(clans, clanId, interactionId))
      }
      await interaction.editReply({ embeds: [embed], components: responseComponents })
    } catch (error) {
      if (handleExpiredInteractionError(error, 'discord.clan_select_response.expired')) return
      discordTelemetry.logger.error('discord.clan_select.failed', error)
      await runInteractionResponse(
        () =>
          interaction.editReply({
            embeds: [buildErrorEmbed('Error', 'Something went wrong while fetching clan data.')],
            components: [],
          }),
        'discord.clan_select_error_response.expired',
      )
    }
  }
}

export const handleClanSelect = createClanSelectHandler()

export async function handleClanPage(interaction: ButtonInteraction): Promise<void> {
  const [, interactionId, pageStr] = interaction.customId.split(':')
  const page = Number.parseInt(pageStr, 10)

  const cached = clanCache.get(interactionId)
  if (!cached || Date.now() - cached.timestamp > CLAN_CACHE_TTL) {
    await runInteractionResponse(
      () =>
        interaction.reply({
          content: 'This interaction has expired. Please run the command again.',
          ephemeral: true,
        }),
      'discord.clan_page_response.expired',
    )
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

  await runInteractionResponse(
    () =>
      interaction.update({
        embeds: [embed],
        // biome-ignore lint/suspicious/noExplicitAny: mixed component row types from discord.js
        components: components as any[],
      }),
    'discord.clan_page_response.expired',
  )
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
): Array<{ clanId: number; clanName: string; memberCount: number | null }> {
  try {
    if (!('components' in message)) return []
    type SelectOption = { label: string; value: string; description?: string }
    type OptionLike = SelectOption | { data: SelectOption }
    type ComponentLike = {
      type?: number
      options?: OptionLike[]
      data?: { type?: number; options?: OptionLike[] }
      components?: ComponentLike[]
    }
    const rows = message.components as unknown as ComponentLike[]
    const select = rows
      .flatMap((row) => row.components ?? [])
      .find((component) => component.type === 3 || component.data?.type === 3)
    if (!select) return []

    const options = select.options ?? select.data?.options ?? []

    return options.map((option) => {
      const opt = 'data' in option ? option.data : option
      const memberCount = Number.parseInt(opt.description?.split(' ')[0] ?? '', 10)
      return {
        clanId: Number.parseInt(opt.value, 10),
        clanName: opt.label,
        memberCount: Number.isFinite(memberCount) ? memberCount : null,
      }
    })
  } catch {
    return []
  }
}
