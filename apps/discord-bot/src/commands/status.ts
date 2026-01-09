import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import type { Command } from './index.js';

export const statusCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check relevant statuses of Brawlhalla services'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const targets = [
      { name: 'Brawlhalla', url: 'https://www.brawlhalla.com' },
      { name: 'BrawlTome', url: 'https://brawltome.app' },
    ];

    const results = await Promise.all(
      targets.map(async (target) => {
        const start = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
          const response = await fetch(target.url, {
            signal: controller.signal,
          });
          const end = performance.now();
          clearTimeout(timeoutId);

          return {
            name: target.name,
            url: target.url,
            status: response.ok ? 'Online' : 'Error',
            latency: Math.round(end - start),
            code: response.status,
          };
        } catch {
          clearTimeout(timeoutId);
          return {
            name: target.name,
            url: target.url,
            status: 'Offline',
            latency: null,
            code: null,
          };
        }
      }),
    );

    const embed = new EmbedBuilder()
      .setTitle('🌐 Service Status')
      .setColor(
        results.every((r) => r.status === 'Online')
          ? Colors.Green
          : results.some((r) => r.status === 'Online')
          ? Colors.Orange
          : Colors.Red,
      )
      .setTimestamp()
      .setFooter({ text: 'BrawlTome Status Check' });

    results.forEach((res) => {
      const statusIcon = res.status === 'Online' ? '✅' : '❌';
      const latencyText = res.latency !== null ? `\`${res.latency}ms\`` : 'N/A';
      embed.addFields({
        name: `${statusIcon} ${res.name}`,
        value: `Status: **${res.status}**\nPing: ${latencyText}${
          res.code ? `\nCode: \`${res.code}\`` : ''
        }`,
        inline: true,
      });
    });

    await interaction.editReply({ embeds: [embed] });
  },
};
