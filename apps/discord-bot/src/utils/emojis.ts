import { REST, Routes } from 'discord.js';

interface DiscordEmoji {
  id: string;
  name: string;
}

let emojiCache: Map<string, DiscordEmoji> | null = null;
let restClient: REST | null = null;
let appClientId: string | null = null;

/**
 * Initialize and load application emojis from Discord
 */
export async function initEmojis(rest: REST, clientId: string): Promise<void> {
  restClient = rest;
  appClientId = clientId;
  await loadEmojis();
}

/**
 * Load/reload emojis from Discord
 */
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

/**
 * Get an emoji string by exact name
 * Returns <:name:id> format or fallback
 */
export function getEmoji(name: string, fallback = ''): string {
  if (!emojiCache) return fallback;

  const emoji = emojiCache.get(name);
  if (emoji) {
    return `<:${emoji.name}:${emoji.id}>`;
  }

  return fallback;
}

/**
 * Get the logo emoji
 */
export function getLogo(): string {
  return getEmoji('logo', '🎮');
}

/**
 * Get a tier banner emoji
 * @param tier - Tier name like "Diamond", "Gold", "Platinum 2", etc.
 */
export function getBannerEmoji(tier: string): string {
  const baseTier = tier?.split(' ')[0]?.toLowerCase() || 'unranked';
  return getEmoji(`banner_${baseTier}`, getTierFallback(baseTier));
}

/**
 * Get a legend avatar emoji by legend name key
 * @param legendNameKey - Legend name key like "ada", "bodvar", "queen_nai"
 */
export function getAvatarEmoji(legendNameKey: string): string {
  const key = legendNameKey?.toLowerCase().replace(/\s+/g, '_') || '';
  return getEmoji(`avatar_${key}`, '👤');
}

/**
 * Get a weapon emoji by weapon name
 * @param weapon - Weapon name like "Sword", "Bow", "Grapple Hammer"
 */
export function getWeaponEmoji(weapon: string): string {
  const key = weapon?.toLowerCase().replace(/\s+/g, '_') || '';
  return getEmoji(`weapon_${key}`, '⚔️');
}

/**
 * Fallback emojis for tiers when custom emojis aren't available
 */
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

/**
 * Check if emojis have been loaded
 */
export function emojisLoaded(): boolean {
  return emojiCache !== null && emojiCache.size > 0;
}

/**
 * Get count of loaded emojis
 */
export function getEmojiCount(): number {
  return emojiCache?.size || 0;
}

/**
 * Clear the emoji cache (useful for reloading)
 */
export function clearEmojiCache(): void {
  emojiCache = null;
}

/**
 * Get the raw emoji cache for use in components
 */
export function getEmojiCache(): Map<string, DiscordEmoji> | null {
  return emojiCache;
}
