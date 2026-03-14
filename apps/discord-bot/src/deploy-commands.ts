import { REST, Routes } from 'discord.js'
import { commandsData } from './commands/index'

const DISCORD_TOKEN = process.env.DISCORD_TOKEN
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable')
  process.exit(1)
}

if (!DISCORD_CLIENT_ID) {
  console.error('Missing DISCORD_CLIENT_ID environment variable')
  process.exit(1)
}

const token: string = DISCORD_TOKEN
const clientId: string = DISCORD_CLIENT_ID

const rest = new REST().setToken(token)

async function deployCommands() {
  try {
    console.log(`Deploying ${commandsData.length} slash commands...`)
    console.log('Commands:', commandsData.map((c) => c.name).join(', '))

    if (DISCORD_GUILD_ID) {
      console.log(`Deploying to guild: ${DISCORD_GUILD_ID}`)
      await rest.put(Routes.applicationGuildCommands(clientId, DISCORD_GUILD_ID), { body: commandsData })
      console.log('Successfully deployed guild commands!')
    } else {
      console.log('Deploying globally (may take up to 1 hour to propagate)')
      await rest.put(Routes.applicationCommands(clientId), {
        body: commandsData,
      })
      console.log('Successfully deployed global commands!')
    }
  } catch (error) {
    console.error('Error deploying commands:', error)
    process.exit(1)
  }
}

void deployCommands()
