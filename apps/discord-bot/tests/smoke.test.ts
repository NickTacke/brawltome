import { describe, expect, test } from 'bun:test'
import { runDiscordSmoke } from '../src/smoke'

const commands = [{ name: 'player' }, { name: 'clan' }, { name: 'status' }]
const baseEnvironment = {
  DISCORD_TOKEN: 'discord-token-secret',
  DISCORD_CLIENT_ID: 'client-42',
  DISCORD_GUILD_ID: 'guild-77',
  API_URL: 'https://api.example.test',
  DISCORD_SMOKE_ARTIFACT_PATH: 'artifacts/discord-smoke.json',
}

describe('Discord smoke preflight', () => {
  test('commits honest pending staging and production evidence templates', async () => {
    for (const name of ['staging-guild', 'production']) {
      const artifact = await Bun.file(`${import.meta.dir}/../smoke/${name}.pending.json`).json()
      expect(artifact).toMatchObject({
        schema: 1,
        environment: name,
        status: 'pending',
        liveDeploymentClaim: false,
      })
    }
  })

  test('fails closed before network work when required credentials are absent', async () => {
    let networkCalls = 0
    await expect(
      runDiscordSmoke('staging-guild', {
        environment: {},
        listCommands: async () => {
          networkCalls++
          return commands
        },
      }),
    ).rejects.toThrow('Missing required smoke configuration')
    expect(networkCalls).toBe(0)
  })

  test('emits a redacted staging-guild artifact without claiming live interaction success', async () => {
    let written = ''
    const artifact = await runDiscordSmoke('staging-guild', {
      environment: baseEnvironment,
      listCommands: async ({ scope }) => {
        expect(scope).toEqual({ kind: 'guild', guildId: 'guild-77' })
        return commands
      },
      fetcher: async (input) => Response.json({ status: String(input).endsWith('/health/live') ? 'live' : 'ready' }),
      now: () => new Date('2026-08-10T12:00:00.000Z'),
      writeArtifact: async (_path, contents) => {
        written = contents
      },
    })

    expect(artifact.status).toBe('preflight-passed')
    expect(artifact.liveDeploymentClaim).toBe(false)
    expect(artifact.interactionChecks.every((check) => check.status === 'pending')).toBe(true)
    expect(written).not.toContain(baseEnvironment.DISCORD_TOKEN)
    expect(written).not.toContain(baseEnvironment.DISCORD_CLIENT_ID)
    expect(written).not.toContain(baseEnvironment.DISCORD_GUILD_ID)
  })

  test('checks global registration for production while leaving command outcomes pending', async () => {
    const artifact = await runDiscordSmoke('production', {
      environment: { ...baseEnvironment, DISCORD_GUILD_ID: '' },
      listCommands: async ({ scope }) => {
        expect(scope).toEqual({ kind: 'global' })
        return commands
      },
      fetcher: async (input) => Response.json({ status: String(input).endsWith('/health/live') ? 'live' : 'ready' }),
      writeArtifact: async () => {},
    })

    expect(artifact.environment).toBe('production')
    expect(artifact.interactionChecks.map((check) => check.command)).toEqual(['/player', '/clan', '/status'])
    expect(artifact.interactionChecks.every((check) => check.status === 'pending')).toBe(true)
  })
})
