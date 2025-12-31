import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';

/**
 * Sync emojis from the web app's public images to Discord application emojis.
 *
 * This syncs:
 *   - Logo (logo)
 *   - Tier banners (banner_diamond, banner_gold, etc.)
 *   - Legend avatars (avatar_ada, avatar_bodvar, etc.)
 *   - Weapons (weapon_sword, weapon_bow, etc.)
 *
 * Usage:
 *   pnpm run sync-emojis
 */

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error(
    'Missing DISCORD_TOKEN or DISCORD_CLIENT_ID environment variable',
  );
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);

// Path to web app's public images
const WEB_IMAGES_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  'web',
  'public',
  'images',
);

interface DiscordEmoji {
  id: string;
  name: string;
}

interface LocalEmoji {
  name: string;
  path: string;
}

async function getExistingEmojis(): Promise<DiscordEmoji[]> {
  const emojis = (await rest.get(
    Routes.applicationEmojis(DISCORD_CLIENT_ID!),
  )) as { items: DiscordEmoji[] };
  return emojis.items || [];
}

async function deleteEmoji(emojiId: string, name: string): Promise<void> {
  await rest.delete(Routes.applicationEmoji(DISCORD_CLIENT_ID!, emojiId));
  console.log(`  ❌ Deleted: ${name}`);
}

async function createEmoji(name: string, imageData: string): Promise<void> {
  await rest.post(Routes.applicationEmojis(DISCORD_CLIENT_ID!), {
    body: {
      name,
      image: imageData,
    },
  });
  console.log(`  ✅ Created: ${name}`);
}

function getImageDataUri(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };

  const mimeType = mimeTypes[ext] || 'image/png';
  const imageBuffer = readFileSync(filePath);
  const base64 = imageBuffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function getLocalEmojis(): LocalEmoji[] {
  const emojis: LocalEmoji[] = [];

  if (!existsSync(WEB_IMAGES_DIR)) {
    console.error(`Web images directory not found: ${WEB_IMAGES_DIR}`);
    process.exit(1);
  }

  // 1. Logo
  const logoPath = join(WEB_IMAGES_DIR, 'logo.png');
  if (existsSync(logoPath)) {
    emojis.push({ name: 'logo', path: logoPath });
  }

  // 2. Tier banners
  const bannersDir = join(WEB_IMAGES_DIR, 'banners');
  if (existsSync(bannersDir)) {
    const bannerFiles = readdirSync(bannersDir).filter((f) =>
      /\.(png|jpg|jpeg|gif|webp)$/i.test(f),
    );
    for (const file of bannerFiles) {
      const name = sanitizeName(basename(file, extname(file)));
      emojis.push({
        name: `banner_${name}`,
        path: join(bannersDir, file),
      });
    }
  }

  // 3. Legend avatars
  const avatarsDir = join(WEB_IMAGES_DIR, 'legends', 'avatars');
  if (existsSync(avatarsDir)) {
    const avatarFiles = readdirSync(avatarsDir).filter((f) =>
      /\.(png|jpg|jpeg|gif|webp)$/i.test(f),
    );
    for (const file of avatarFiles) {
      const name = sanitizeName(basename(file, extname(file)));
      emojis.push({
        name: `avatar_${name}`,
        path: join(avatarsDir, file),
      });
    }
  }

  // 4. Weapons
  const weaponsDir = join(WEB_IMAGES_DIR, 'weapons');
  if (existsSync(weaponsDir)) {
    const weaponFiles = readdirSync(weaponsDir).filter((f) =>
      /\.(png|jpg|jpeg|gif|webp)$/i.test(f),
    );
    for (const file of weaponFiles) {
      const name = sanitizeName(basename(file, extname(file)));
      emojis.push({
        name: `weapon_${name}`,
        path: join(weaponsDir, file),
      });
    }
  }

  return emojis;
}

async function syncEmojis(): Promise<void> {
  console.log('🔄 Syncing emojis to Discord application...\n');

  // Get existing emojis from Discord
  const existingEmojis = await getExistingEmojis();
  const existingByName = new Map(existingEmojis.map((e) => [e.name, e]));
  console.log(`📦 Found ${existingEmojis.length} existing emojis on Discord`);

  // Get local emojis
  const localEmojis = getLocalEmojis();
  const localByName = new Map(localEmojis.map((e) => [e.name, e]));
  console.log(`📁 Found ${localEmojis.length} local emojis to sync`);
  console.log(
    `   - 1 logo, ${
      localEmojis.filter((e) => e.name.startsWith('banner_')).length
    } banners, ${
      localEmojis.filter((e) => e.name.startsWith('avatar_')).length
    } avatars, ${
      localEmojis.filter((e) => e.name.startsWith('weapon_')).length
    } weapons\n`,
  );

  // Delete emojis that no longer exist locally
  console.log('🗑️  Checking for emojis to delete...');
  let deleted = 0;
  for (const [name, emoji] of existingByName) {
    if (!localByName.has(name)) {
      try {
        await deleteEmoji(emoji.id, name);
        deleted++;
        // Rate limit: wait a bit between deletions
        await new Promise((r) => setTimeout(r, 100));
      } catch (error) {
        console.error(`  ⚠️  Failed to delete ${name}:`, error);
      }
    }
  }
  if (deleted === 0) console.log('  None to delete');

  // Create emojis that don't exist yet
  console.log('\n📤 Checking for emojis to create...');
  let created = 0;
  let failed = 0;
  for (const local of localEmojis) {
    if (!existingByName.has(local.name)) {
      try {
        const imageData = getImageDataUri(local.path);
        await createEmoji(local.name, imageData);
        created++;
        // Rate limit: wait a bit between creations
        await new Promise((r) => setTimeout(r, 250));
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        // Check if it's a size issue
        if (errorMessage.includes('256')) {
          console.error(`  ⚠️  ${local.name}: Image too large (max 256KB)`);
        } else {
          console.error(`  ⚠️  Failed to create ${local.name}:`, errorMessage);
        }
        failed++;
      }
    }
  }
  if (created === 0 && failed === 0) console.log('  None to create');

  console.log(
    `\n✨ Sync complete! Created: ${created}, Deleted: ${deleted}, Failed: ${failed}`,
  );

  // Generate emoji map for use in code
  if (created > 0 || existingEmojis.length > 0) {
    const updatedEmojis = await getExistingEmojis();
    console.log(`\n📋 Total emojis: ${updatedEmojis.length}/2000`);

    // Output a summary grouped by type
    const grouped = {
      logo: updatedEmojis.filter((e) => e.name === 'logo'),
      banners: updatedEmojis.filter((e) => e.name.startsWith('banner_')),
      avatars: updatedEmojis.filter((e) => e.name.startsWith('avatar_')),
      weapons: updatedEmojis.filter((e) => e.name.startsWith('weapon_')),
    };

    console.log(`   Logo: ${grouped.logo.length}`);
    console.log(`   Banners: ${grouped.banners.length}`);
    console.log(`   Avatars: ${grouped.avatars.length}`);
    console.log(`   Weapons: ${grouped.weapons.length}`);
  }
}

void syncEmojis().catch(console.error);
