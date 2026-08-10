import { type TelemetryFetch, telemetryFetch } from '@brawltome/telemetry'
import { type ChatInputCommandInteraction, Colors, EmbedBuilder, SlashCommandBuilder } from 'discord.js'
import { runInteractionResponse } from '../interaction-response'
import { discordTelemetry } from '../lib/telemetry'
import type { Command } from './index'

interface StatusCommandDependencies {
  fetcher?: TelemetryFetch
  apiUrl?: string
  timeoutMs?: number
}

type ProbeState = 'available' | 'degraded' | 'unavailable'

type HealthProbe = {
  state: ProbeState
  label: 'Live' | 'Ready' | 'Degraded' | 'Unavailable'
}

async function probeHealth(
  fetcher: TelemetryFetch,
  apiUrl: string,
  path: '/health/live' | '/health/ready',
  timeoutMs: number,
): Promise<HealthProbe> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await telemetryFetch(discordTelemetry, 'api', fetcher, `${apiUrl}${path}`, {
      signal: controller.signal,
    })
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null
    if (path === '/health/live' && response.ok && body?.status === 'live') {
      return { state: 'available', label: 'Live' }
    }
    if (path === '/health/ready' && response.ok && body?.status === 'ready') {
      return { state: 'available', label: 'Ready' }
    }
    if (path === '/health/ready' && response.status === 503 && body?.status === 'unready') {
      return { state: 'degraded', label: 'Degraded' }
    }
    return { state: 'unavailable', label: 'Unavailable' }
  } catch {
    return { state: 'unavailable', label: 'Unavailable' }
  } finally {
    clearTimeout(timeout)
  }
}

function statusIcon(state: ProbeState): string {
  if (state === 'available') return '✅'
  if (state === 'degraded') return '⚠️'
  return '❌'
}

export function createStatusCommand({
  fetcher = fetch,
  apiUrl = process.env.API_URL ?? 'http://localhost:3000',
  timeoutMs = 2_000,
}: StatusCommandDependencies = {}): Command {
  return {
    data: new SlashCommandBuilder().setName('status').setDescription('Check BrawlTome process and dependency status'),

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
      if (!(await runInteractionResponse(() => interaction.deferReply(), 'discord.status_acknowledgement.expired'))) {
        return
      }

      const [liveness, readiness] = await Promise.all([
        probeHealth(fetcher, apiUrl, '/health/live', timeoutMs),
        probeHealth(fetcher, apiUrl, '/health/ready', timeoutMs),
      ])
      const color =
        liveness.state === 'unavailable' ? Colors.Red : readiness.state === 'available' ? Colors.Green : Colors.Orange
      const embed = new EmbedBuilder()
        .setTitle('🌐 Service Status')
        .setColor(color)
        .addFields(
          {
            name: `${statusIcon(liveness.state)} API Process`,
            value: `Status: **${liveness.label}**`,
            inline: true,
          },
          {
            name: `${statusIcon(readiness.state)} API Dependencies`,
            value: `Status: **${readiness.label}**`,
            inline: true,
          },
        )
        .setTimestamp()
        .setFooter({ text: 'BrawlTome Status Check' })

      await runInteractionResponse(() => interaction.editReply({ embeds: [embed] }), 'discord.status_response.expired')
    },
  }
}

export const statusCommand = createStatusCommand()
