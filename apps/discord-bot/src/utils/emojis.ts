import { type REST, Routes } from 'discord.js'
import { discordTelemetry } from '../lib/telemetry'

interface DiscordEmoji {
  id: string
  name: string
}

let emojiCache: Map<string, DiscordEmoji> | null = null
let restClient: REST | null = null
let appClientId: string | null = null

export async function initEmojis(rest: REST, clientId: string): Promise<void> {
  restClient = rest
  appClientId = clientId
  await loadEmojis()
}

export async function loadEmojis(): Promise<Map<string, DiscordEmoji>> {
  if (!restClient || !appClientId) {
    discordTelemetry.logger.warn('discord.emojis.not_initialized')
    return new Map()
  }

  try {
    const response = (await restClient.get(Routes.applicationEmojis(appClientId))) as { items: DiscordEmoji[] }

    emojiCache = new Map(response.items.map((e) => [e.name, e]))
    discordTelemetry.logger.info('discord.emojis.loaded', { emojiCount: emojiCache.size })
    return emojiCache
  } catch (error) {
    discordTelemetry.logger.error('discord.emojis.failed', error)
    emojiCache = new Map()
    return emojiCache
  }
}

export function getEmoji(name: string, fallback = ''): string {
  if (!emojiCache) return fallback

  const emoji = emojiCache.get(name)
  if (emoji) {
    return `<:${emoji.name}:${emoji.id}>`
  }

  return fallback
}

export function getBannerEmoji(tier: string | null): string {
  const baseTier = tier?.split(' ')[0]?.toLowerCase() || 'unranked'
  return getEmoji(`banner_${baseTier}`, getTierFallback(baseTier))
}

function getTierFallback(tier: string): string {
  const fallbacks: Record<string, string> = {
    valhallan: '👑',
    diamond: '💎',
    platinum: '✨',
    gold: '🥇',
    silver: '🥈',
    bronze: '🥉',
    tin: '⚪',
    unranked: '➖',
  }
  return fallbacks[tier] || '➖'
}

export function getEmojiCount(): number {
  return emojiCache?.size || 0
}

export function getEmojiCache(): Map<string, DiscordEmoji> | null {
  return emojiCache
}
