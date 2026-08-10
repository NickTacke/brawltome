import {
  ActivityType,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  REST,
} from 'discord.js'
import { handleClanPage, handleClanSelect } from './commands/clan'
import { commands } from './commands/index'
import { handlePlayerSelect } from './commands/player'
import { createInteractionRuntime } from './interaction-runtime'
import { discordTelemetry } from './lib/telemetry'
import { startDiscordMetricsServer } from './metrics-server'
import { setEmojiCache } from './utils/components'
import { getEmojiCache, getEmojiCount, initEmojis } from './utils/emojis'

const discordToken = process.env.DISCORD_TOKEN
const discordClientId = process.env.DISCORD_CLIENT_ID
if (!discordToken) throw new Error('DISCORD_TOKEN is required')

const client = new Client({ intents: [GatewayIntentBits.Guilds] })
const interactions = createInteractionRuntime(discordTelemetry)

const metricsServer = startDiscordMetricsServer({
  telemetry: discordTelemetry,
  port: Number(process.env.DISCORD_METRICS_PORT ?? 3002),
  secret: process.env.INTERNAL_API_SECRET,
})

client.once(Events.ClientReady, async (readyClient) => {
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
      if (interaction.replied || interaction.deferred) await interaction.followUp(errorMessage)
      else await interaction.reply(errorMessage)
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
  const kind = interaction.isChatInputCommand() ? 'command' : interaction.isStringSelectMenu() ? 'select' : 'button'
  const command = interaction.isChatInputCommand() ? commandLabel(interaction.commandName) : 'component'
  interactions.run({ id: interaction.id, kind, command }, () => dispatchInteraction(interaction))
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
    const drained = await interactions.drain(Math.max(0, deadline - Date.now() - 1_000))
    try {
      client.destroy()
    } catch (error) {
      discordTelemetry.logger.error('discord.client.destroy_failed', error)
    }
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
