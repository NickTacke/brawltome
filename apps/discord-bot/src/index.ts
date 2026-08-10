import {
  ActivityType,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  REST,
} from 'discord.js'
import { createApiReadinessMonitor } from './api-readiness'
import { handleClanPage, handleClanSelect } from './commands/clan'
import { commands } from './commands/index'
import { handlePlayerSelect } from './commands/player'
import { runInteractionResponse } from './interaction-response'
import { createInteractionRuntime } from './interaction-runtime'
import { discordTelemetry } from './lib/telemetry'
import { api } from './lib/trpc'
import { startDiscordMetricsServer } from './metrics-server'
import { setEmojiCache } from './utils/components'
import { getEmojiCache, getEmojiCount, initEmojis } from './utils/emojis'

const discordToken = process.env.DISCORD_TOKEN
const discordClientId = process.env.DISCORD_CLIENT_ID
const internalSecret = process.env.INTERNAL_API_SECRET
const discordInternalSecret = process.env.DISCORD_INTERNAL_API_SECRET
if (!discordToken) throw new Error('DISCORD_TOKEN is required')
if (!internalSecret || internalSecret.length < 32) throw new Error('INTERNAL_API_SECRET must be at least 32 characters')
if (!discordInternalSecret || discordInternalSecret.length < 32) {
  throw new Error('DISCORD_INTERNAL_API_SECRET must be at least 32 characters')
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] })
const interactions = createInteractionRuntime(discordTelemetry)
let gatewayReady = false
const apiReadiness = createApiReadinessMonitor({ verify: verifyApiAccess })

const metricsServer = startDiscordMetricsServer({
  telemetry: discordTelemetry,
  port: Number(process.env.DISCORD_METRICS_PORT ?? 3002),
  secret: internalSecret,
  readiness: () => gatewayReady && apiReadiness.isReady() && interactions.accepting,
})

async function verifyApiAccess(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2_000)
  try {
    await api.status.discordReady.query(undefined, { signal: controller.signal })
    return true
  } catch (error) {
    discordTelemetry.logger.error('discord.api_readiness.failed', error)
    return false
  } finally {
    clearTimeout(timeout)
  }
}

client.on(Events.ShardDisconnect, () => {
  gatewayReady = false
  apiReadiness.clear()
})
client.on(Events.ShardReady, () => {
  gatewayReady = true
  void apiReadiness.check()
})

client.once(Events.ClientReady, async (readyClient) => {
  gatewayReady = true
  await apiReadiness.check()
  discordTelemetry.logger.info('discord.ready', { guildCount: readyClient.guilds.cache.size })
  readyClient.user.setPresence({
    activities: [{ name: 'https://brawltome.app', type: ActivityType.Watching }],
    status: 'online',
  })
  if (!discordClientId) return
  try {
    const rest = new REST().setToken(discordToken)
    await initEmojis(rest, discordClientId)
    const cache = getEmojiCache()
    if (cache) setEmojiCache(cache)
    discordTelemetry.logger.info('discord.emojis.loaded', { emojiCount: getEmojiCount() })
  } catch (error) {
    discordTelemetry.logger.error('discord.emojis.failed', error)
  }
})

function commandLabel(value: string): 'player' | 'clan' | 'status' | 'unknown' {
  return value === 'player' || value === 'clan' || value === 'status' ? value : 'unknown'
}

async function dispatchInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName)
    if (!command) {
      discordTelemetry.logger.warn('discord.command.unknown', { command: 'unknown' })
      return
    }
    try {
      await command.execute(interaction as ChatInputCommandInteraction)
    } catch (error) {
      const errorMessage = { content: 'There was an error executing this command.', ephemeral: true }
      try {
        await runInteractionResponse(
          () =>
            interaction.replied || interaction.deferred
              ? interaction.followUp(errorMessage)
              : interaction.reply(errorMessage),
          'discord.command_error_response.expired',
        )
      } catch (responseError) {
        discordTelemetry.logger.error('discord.command_error_response.failed', responseError)
      }
      throw error
    }
    return
  }

  if (interaction.isStringSelectMenu()) {
    const [customId] = interaction.customId.split(':')
    if (customId === 'player_select') await handlePlayerSelect(interaction)
    else if (customId === 'clan_select') await handleClanSelect(interaction)
    else discordTelemetry.logger.warn('discord.component.unknown', { interactionKind: 'select' })
    return
  }

  if (interaction.isButton()) {
    const [customId] = interaction.customId.split(':')
    if (customId === 'clan_page') await handleClanPage(interaction)
    else discordTelemetry.logger.warn('discord.component.unknown', { interactionKind: 'button' })
  }
}

client.on(Events.InteractionCreate, (interaction: Interaction) => {
  const kind = interaction.isChatInputCommand()
    ? 'command'
    : interaction.isStringSelectMenu()
      ? 'select'
      : interaction.isButton()
        ? 'button'
        : null
  if (!kind) {
    discordTelemetry.logger.warn('discord.interaction.unsupported')
    return
  }
  const command = interaction.isChatInputCommand() ? commandLabel(interaction.commandName) : 'component'
  const accepted = interactions.run({ id: interaction.id, kind, command }, () => dispatchInteraction(interaction))
  if (!accepted && interaction.isRepliable()) {
    const rejectedInteraction = interaction
    void runInteractionResponse(
      () =>
        rejectedInteraction.reply({ content: 'BrawlTome is restarting. Please try again shortly.', ephemeral: true }),
      'discord.rejected_response.expired',
    ).catch((error) => discordTelemetry.logger.error('discord.rejected_response.failed', error))
  }
})

async function bounded(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const completed = work.then(
    () => true,
    () => false,
  )
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(1, timeoutMs))
  })
  const result = await Promise.race([completed, timedOut])
  if (timer) clearTimeout(timer)
  return result
}

let shutdownPromise: Promise<void> | undefined
function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    discordTelemetry.logger.info('discord.shutdown.started')
    const configuredDeadline = Number(process.env.RUNTIME_SHUTDOWN_DEADLINE_MS ?? 60_000)
    const deadlineMs = Number.isFinite(configuredDeadline) && configuredDeadline > 0 ? configuredDeadline : 60_000
    const deadline = Date.now() + deadlineMs
    interactions.stopAccepting()
    gatewayReady = false
    apiReadiness.stop()
    try {
      client.destroy()
    } catch (error) {
      discordTelemetry.logger.error('discord.client.destroy_failed', error)
    }
    const drained = await interactions.drain(Math.max(0, deadline - Date.now() - 1_000))
    const serverStopped = metricsServer
      ? await bounded(metricsServer.stop(true), Math.max(1, deadline - Date.now() - 500))
      : true
    const telemetryStopped = await bounded(
      discordTelemetry.shutdown(Math.max(1, deadline - Date.now())),
      Math.max(1, deadline - Date.now()),
    )
    if (!drained || !serverStopped || !telemetryStopped) process.exitCode = 1
  })()
  return shutdownPromise
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void shutdown())

void client.login(discordToken).catch(async (error) => {
  discordTelemetry.logger.error('discord.login.failed', error)
  process.exitCode = 1
  await shutdown()
})
