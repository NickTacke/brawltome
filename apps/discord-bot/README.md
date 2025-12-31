# BrawlTome Discord Bot

A Discord bot for looking up Brawlhalla player and clan statistics.

## Features

- `/player <query>` - Look up a player by name or Brawlhalla ID
- `/clan <query>` - Look up a clan by name or clan ID
- Auto-refresh: Messages automatically update when stale data is refreshed

## Setup

### 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section and click "Add Bot"
4. Copy the bot token (you'll need this)
5. Go to "OAuth2" > "URL Generator"
6. Select scopes: `bot`, `applications.commands`
7. Select permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`
8. Use the generated URL to invite the bot to your server

### 2. Environment Variables

Create a `.env` file or set these environment variables:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
API_URL=http://localhost:3000

# Optional: for guild-specific command deployment (faster for development)
DISCORD_GUILD_ID=your_test_guild_id
```

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Deploy Slash Commands

Deploy commands to Discord (only needed once, or when commands change):

```bash
# For development (instant, guild-specific)
DISCORD_GUILD_ID=your_guild_id pnpm run deploy-commands

# For production (global, takes up to 1 hour)
pnpm run deploy-commands
```

### 5. Run the Bot

```bash
# Development (with hot reload)
pnpm run start:dev

# Production
pnpm run start
```

## Commands

### `/player <query>`

Look up a Brawlhalla player by name or ID.

**Examples:**

- `/player xJcoolJ` - Search by name
- `/player 73041583` - Look up by exact Brawlhalla ID

**Shows:**

- Ranked 1v1 stats (rating, peak, tier, win rate)
- General stats (level, playtime, clan)
- Top 3 legends by rating
- Top 2v2 teams

### `/clan <query>`

Look up a Brawlhalla clan by name or ID.

**Examples:**

- `/clan Mariejois` - Search by name
- `/clan 2482556` - Look up by exact clan ID

**Shows:**

- Clan stats (XP, lifetime XP, member count)
- Creation date
- Top 5 members by XP

## Auto-Refresh

When data is stale and being refreshed in the background, the embed will show a "🔄 Refreshing data..." indicator. The bot will automatically poll the API and update the message when fresh data is available (up to 3 attempts, 5 seconds apart).

## Development

The bot is built with:

- [discord.js](https://discord.js.org/) v14
- TypeScript
- Native fetch API

It calls the existing BrawlTome API for all data, so make sure the API is running.
