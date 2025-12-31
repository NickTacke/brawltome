import { REST, Routes } from 'discord.js';

interface DiscordEmoji {
  id: string;
  name: string;
}

let emojiCache: Map<string, DiscordEmoji> | null = null;
let restClient: REST | null = null;
let appClientId: string | null = null;

export async function initEmojis(rest: REST, clientId: string): Promise<void> {
  restClient = rest;
  appClientId = clientId;
  await loadEmojis();
}

export async function loadEmojis(): Promise<Map<string, DiscordEmoji>> {
  if (!restClient || !appClientId) {
    console.warn('[Emojis] Not initialized - call initEmojis first');
    return new Map();
  }

  try {
    const response = (await restClient.get(
      Routes.applicationEmojis(appClientId),
    )) as { items: DiscordEmoji[] };

    emojiCache = new Map(response.items.map((e) => [e.name, e]));
    console.log(`[Emojis] Loaded ${emojiCache.size} application emojis`);
    return emojiCache;
  } catch (error) {
    console.error('[Emojis] Failed to load emojis:', error);
    emojiCache = new Map();
    return emojiCache;
  }
}

export function getEmoji(name: string, fallback = ''): string {
  if (!emojiCache) return fallback;

  const emoji = emojiCache.get(name);
  if (emoji) {
    return `<:${emoji.name}:${emoji.id}>`;
  }

  return fallback;
}

export function getLogo(): string {
  return getEmoji('logo', '🎮');
}

export function getBannerEmoji(tier: string): string {
  const baseTier = tier?.split(' ')[0]?.toLowerCase() || 'unranked';
  return getEmoji(`banner_${baseTier}`, getTierFallback(baseTier));
}

export function getAvatarEmoji(legendNameKey: string): string {
  const key = legendNameKey?.toLowerCase().replace(/\s+/g, '_') || '';
  return getEmoji(`avatar_${key}`, '👤');
}

export function getWeaponEmoji(weapon: string): string {
  const key = weapon?.toLowerCase().replace(/\s+/g, '_') || '';
  return getEmoji(`weapon_${key}`, '⚔️');
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
  };
  return fallbacks[tier] || '➖';
}

export function emojisLoaded(): boolean {
  return emojiCache !== null && emojiCache.size > 0;
}

export function getEmojiCount(): number {
  return emojiCache?.size || 0;
}

export function clearEmojiCache(): void {
  emojiCache = null;
}

export function getEmojiCache(): Map<string, DiscordEmoji> | null {
  return emojiCache;
}
