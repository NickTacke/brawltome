import { escapeMarkdown } from 'discord.js'

export function escapeDiscordText(value: string): string {
  return escapeMarkdown(value, { maskedLink: true }).replaceAll('@', '@\u200b')
}
