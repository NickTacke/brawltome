import {
  Collection,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { playerCommand } from './player.js';
import { clanCommand } from './clan.js';

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

// Command registry
export const commands = new Collection<string, Command>();

// Register all commands
const commandList: Command[] = [playerCommand, clanCommand];

for (const command of commandList) {
  commands.set(command.data.name, command);
}

// Export command data for deployment
export const commandsData = commandList.map((cmd) => cmd.data.toJSON());
