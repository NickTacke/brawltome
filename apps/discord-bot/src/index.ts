import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Events,
  Interaction,
  ChatInputCommandInteraction,
  REST,
  ActivityType,
} from 'discord.js';
import { commands } from './commands/index.js';
import { handlePlayerSelect } from './commands/player.js';
import { handleClanSelect } from './commands/clan.js';
import { initEmojis, getEmojiCount, getEmojiCache } from './utils/emojis.js';
import { setEmojiCache } from './utils/components.js';

// Environment validation
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable');
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Ready event
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Discord bot ready! Logged in as ${readyClient.user.tag}`);
  console.log(`Serving ${readyClient.guilds.cache.size} guilds`);

  // Set bot status
  readyClient.user.setPresence({
    activities: [
      { name: 'https://brawltome.app', type: ActivityType.Watching },
    ],
    status: 'online',
  });

  // Load application emojis
  if (DISCORD_CLIENT_ID) {
    const rest = new REST().setToken(DISCORD_TOKEN);
    await initEmojis(rest, DISCORD_CLIENT_ID);
    // Share emoji cache with components for select menus
    const cache = getEmojiCache();
    if (cache) setEmojiCache(cache);
    console.log(`Loaded ${getEmojiCount()} application emojis`);
  }
});

// Interaction handler
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) {
      console.warn(`Unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction as ChatInputCommandInteraction);
    } catch (error) {
      console.error(
        `Error executing command ${interaction.commandName}:`,
        error,
      );

      const errorMessage = {
        content: 'There was an error executing this command.',
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
    return;
  }

  // Handle select menu interactions
  if (interaction.isStringSelectMenu()) {
    try {
      switch (interaction.customId) {
        case 'player_select':
          await handlePlayerSelect(interaction);
          break;
        case 'clan_select':
          await handleClanSelect(interaction);
          break;
        default:
          console.warn(`Unknown select menu: ${interaction.customId}`);
      }
    } catch (error) {
      console.error(
        `Error handling select menu ${interaction.customId}:`,
        error,
      );
    }
  }
});

// Login
void client.login(DISCORD_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  void client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  void client.destroy();
  process.exit(0);
});
