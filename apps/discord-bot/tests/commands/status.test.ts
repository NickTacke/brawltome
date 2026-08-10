import { describe, expect, test } from 'bun:test'
import { type ChatInputCommandInteraction, Colors, type InteractionEditReplyOptions } from 'discord.js'
import { createStatusCommand } from '../../src/commands/status'

function interaction(events: string[]) {
  let reply: InteractionEditReplyOptions | string | undefined
  return {
    value: {
      deferReply: async () => {
        events.push('defer')
      },
      editReply: async (value: InteractionEditReplyOptions | string) => {
        events.push('edit')
        reply = value
        return {} as never
      },
    } as unknown as ChatInputCommandInteraction,
    embed: () => {
      const embed = (reply as InteractionEditReplyOptions).embeds?.[0]
      return embed && 'toJSON' in embed ? embed.toJSON() : embed
    },
  }
}

describe('/status lifecycle command', () => {
  test('acknowledges before probing and reports process liveness separately from readiness', async () => {
    const events: string[] = []
    const fake = interaction(events)
    const fetcher = async (input: RequestInfo | URL) => {
      events.push(String(input).endsWith('/health/live') ? 'live' : 'ready')
      return Response.json({ status: String(input).endsWith('/health/live') ? 'live' : 'ready' })
    }

    await createStatusCommand({ fetcher, apiUrl: 'https://api.example.test' }).execute(fake.value)

    expect(events[0]).toBe('defer')
    expect(fake.embed()?.fields).toEqual([
      { name: '✅ API Process', value: 'Status: **Live**', inline: true },
      { name: '✅ API Dependencies', value: 'Status: **Ready**', inline: true },
    ])
  })

  test('renders an unready live process as degraded rather than offline', async () => {
    const fake = interaction([])
    const fetcher = async (input: RequestInfo | URL) =>
      String(input).endsWith('/health/live')
        ? Response.json({ status: 'live' })
        : Response.json(
            { status: 'unready', reason: 'dependency_failed', dependency: 'postgres-schema' },
            { status: 503 },
          )

    await createStatusCommand({ fetcher, apiUrl: 'https://api.example.test' }).execute(fake.value)

    expect(fake.embed()?.color).toBe(Colors.Orange)
    expect(fake.embed()?.fields?.[0]?.value).toContain('Live')
    expect(fake.embed()?.fields?.[1]?.value).toContain('Degraded')
  })

  test('reports temporary probe failures honestly and bounds probe time', async () => {
    const fake = interaction([])
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    const started = performance.now()

    await createStatusCommand({ fetcher, apiUrl: 'https://api.example.test', timeoutMs: 1 }).execute(fake.value)

    expect(performance.now() - started).toBeLessThan(100)
    expect(fake.embed()?.color).toBe(Colors.Red)
    expect(fake.embed()?.fields?.every((field) => field.value.includes('Unavailable'))).toBe(true)
  })
})
