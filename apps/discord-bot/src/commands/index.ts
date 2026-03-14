import { type ChatInputCommandInteraction, Collection, type SlashCommandBuilder } from 'discord.js'
import { clanCommand } from './clan'
import { playerCommand } from './player'
import { statusCommand } from './status'

export interface Command {
  data: SlashCommandBuilder
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>
}

// Command registry
export const commands = new Collection<string, Command>()

// Register all commands
const commandList: Command[] = [playerCommand, clanCommand, statusCommand]

for (const command of commandList) {
  commands.set(command.data.name, command)
}

// Export command data for deployment
export const commandsData = commandList.map((cmd) => cmd.data.toJSON())
