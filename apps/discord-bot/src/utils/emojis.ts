import { REST, Routes } from 'discord.js';

interface DiscordEmoji {
  id: string;
  name: string;
}

let emojiCache: Map<string, DiscordEmoji> | null = null;
let restClient: REST | null = null;
let appClientId: string | null = null;

/**
 * Initialize emoji utilities with a Discord REST client and application client ID, then preload application emojis.
 *
 * @param rest - Discord REST client used to fetch the application's emojis
 * @param clientId - Application (bot) client ID whose emojis should be loaded
 */
export async function initEmojis(rest: REST, clientId: string): Promise<void> {
  restClient = rest;
  appClientId = clientId;
  await loadEmojis();
}

/**
 * Loads or refreshes the application's custom emojis from Discord into the module cache.
 *
 * Requires initEmojis to have been called; if the module is not initialized this returns an empty Map.
 * On failure to fetch emojis from Discord this returns an empty Map and leaves the cache empty.
 *
 * @returns A Map keyed by emoji name containing the loaded `DiscordEmoji` objects, or an empty Map if none were loaded.
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
 * Retrieve a Discord emoji string for the exact emoji name.
 *
 * @param name - The exact emoji name to look up in the cache
 * @param fallback - Value returned when the emoji is not found or the cache is uninitialized
 * @returns The emoji in `<:name:id>` format if found, `fallback` otherwise
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
 * Retrieve the 'logo' emoji from the emoji cache or a fallback.
 *
 * @returns The emoji string for 'logo' if present in the cache, otherwise '🎮'
 */
export function getLogo(): string {
  return getEmoji('logo', '🎮');
}

/**
 * Selects the banner emoji that corresponds to a rank tier.
 *
 * @param tier - Rank name (e.g., "Diamond", "Gold", "Platinum 2"); the first word is used to determine the base tier
 * @returns The banner emoji for the given tier (custom Discord emoji like `<:name:id>` if available, otherwise a tier-specific Unicode fallback)
 */
export function getBannerEmoji(tier: string): string {
  const baseTier = tier?.split(' ')[0]?.toLowerCase() || 'unranked';
  return getEmoji(`banner_${baseTier}`, getTierFallback(baseTier));
}

/**
 * Get the avatar emoji for a legend using its name key.
 *
 * @param legendNameKey - Legend name or key (case-insensitive; spaces allowed, e.g., "Ada", "queen nai")
 * @returns The custom avatar emoji string `<:name:id>` if available, otherwise the generic user emoji `👤`
 */
export function getAvatarEmoji(legendNameKey: string): string {
  const key = legendNameKey?.toLowerCase().replace(/\s+/g, '_') || '';
  return getEmoji(`avatar_${key}`, '👤');
}

/**
 * Selects the custom weapon emoji for a given weapon name.
 *
 * @param weapon - Weapon name (case-insensitive; spaces are allowed and are converted to underscores)
 * @returns The emoji string for the weapon (e.g., `<:name:id>`), or `⚔️` if no matching custom emoji is found
 */
export function getWeaponEmoji(weapon: string): string {
  const key = weapon?.toLowerCase().replace(/\s+/g, '_') || '';
  return getEmoji(`weapon_${key}`, '⚔️');
}

/**
 * Selects a fallback emoji for a rank tier when a custom emoji is unavailable.
 *
 * @param tier - Tier identifier (e.g., "valhallan", "diamond", "gold", "silver", "bronze", "tin", "unranked")
 * @returns The emoji string for the given tier; returns `'➖'` if the tier is not recognized
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
 * Determine whether the emoji cache has been initialized and contains at least one entry.
 *
 * @returns `true` if the emoji cache has been initialized and contains at least one emoji, `false` otherwise.
 */
export function emojisLoaded(): boolean {
  return emojiCache !== null && emojiCache.size > 0;
}

/**
 * Get the number of emojis currently stored in the cache.
 *
 * @returns The number of cached emojis, or 0 if the cache is not initialized.
 */
export function getEmojiCount(): number {
  return emojiCache?.size || 0;
}

/**
 * Clears the in-memory emoji cache.
 *
 * After calling this, emoji data will be treated as not loaded and must be reinitialized before use.
 */
export function clearEmojiCache(): void {
  emojiCache = null;
}

/**
 * Retrieve the current emoji cache map.
 *
 * @returns The emoji map keyed by name, or `null` if the cache is not initialized.
 */
export function getEmojiCache(): Map<string, DiscordEmoji> | null {
  return emojiCache;
}