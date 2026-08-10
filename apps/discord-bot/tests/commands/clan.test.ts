import { describe, expect, test } from 'bun:test'
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  InteractionEditReplyOptions,
  StringSelectMenuInteraction,
} from 'discord.js'
import {
  createClanCommand,
  createClanSelectHandler,
  handleClanPage,
  pollClanUntilSectionsComplete,
} from '../../src/commands/clan'
import type { ClanResponse } from '../../src/lib/types'

function clan(profileSuccess: string | null, rosterSuccess: string | null): ClanResponse {
  return {
    clanId: 77,
    clanName: 'Clan',
    clanCreateDate: '2026-01-01T00:00:00.000Z',
    clanXp: '1',
    clanLifetimeXp: '2',
    notice: null,
    tags: null,
    discordInviteCode: null,
    guildPoints: null,
    isRecruiting: null,
    profile: {
      checkedAt: profileSuccess,
      checkProvenance: { source: 'v1-guild-stats', outcome: 'success' },
      lastSuccessAt: profileSuccess,
      lastSuccessProvenance: profileSuccess ? { source: 'v1-guild-stats', outcome: 'success' } : null,
    },
    roster: {
      checkedAt: rosterSuccess,
      checkProvenance: { source: 'v1-guild-members', outcome: 'success' },
      lastSuccessAt: rosterSuccess,
      lastSuccessProvenance: rosterSuccess ? { source: 'v1-guild-members', outcome: 'success' } : null,
    },
    members: [],
  }
}

const observedAt = '2026-08-10T12:00:00.000Z'

function interaction(events: string[], query = '77') {
  let reply: InteractionEditReplyOptions | string | undefined
  return {
    value: {
      id: 'interaction-77',
      user: { id: 'discord-user-77' },
      options: { getString: () => query },
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
    response: () => reply as InteractionEditReplyOptions,
  }
}

describe('Discord clan refresh polling', () => {
  test('keeps polling until every initially stale section advances', async () => {
    const initial = clan(null, null)
    const responses = [
      clan('2026-01-01T01:00:00.000Z', null),
      clan('2026-01-01T01:00:00.000Z', '2026-01-01T01:00:00.000Z'),
    ]
    let queries = 0
    const result = await pollClanUntilSectionsComplete(
      initial,
      2,
      async () => responses[queries++] ?? responses.at(-1) ?? null,
      async () => {},
    )
    expect(queries).toBe(2)
    expect(result?.roster?.lastSuccessAt).toBe('2026-01-01T01:00:00.000Z')
  })

  test('stops at the bounded poll limit when a section remains unavailable', async () => {
    let queries = 0
    await pollClanUntilSectionsComplete(
      null,
      2,
      async () => {
        queries++
        return clan('2026-01-01T01:00:00.000Z', null)
      },
      async () => {},
      3,
    )
    expect(queries).toBe(3)
  })

  test('does not wait past the interaction work deadline', async () => {
    let waits = 0
    let queries = 0
    await pollClanUntilSectionsComplete(
      clan(null, null),
      60,
      async () => {
        queries++
        return clan(observedAt, observedAt)
      },
      async () => {
        waits++
      },
      4,
      () => Date.parse(observedAt),
      Date.parse(observedAt) + 1_000,
    )
    expect(waits).toBe(0)
    expect(queries).toBe(0)
  })
})

describe('/clan canonical command', () => {
  test('acknowledges before network work and renders independent normal section state', async () => {
    const events: string[] = []
    const fake = interaction(events)
    const cached = clan(observedAt, observedAt)
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      clan: {
        byId: { query: async () => cached },
        refreshDiscord: {
          mutate: async () => {
            events.push('refresh')
            return { clan: cached, refresh: { outcome: 'notNeeded', retry: { kind: 'none' } } }
          },
        },
      },
    }

    await createClanCommand({ client: client as never, now: () => Date.parse(observedAt) }).execute(fake.value)

    expect(events[0]).toBe('defer')
    expect(fake.embed()?.title).toBe('Clan')
    expect(fake.embed()?.fields?.[0]?.value).toContain('Profile: Updated')
    expect(fake.embed()?.fields?.[0]?.value).toContain('Roster: Updated')
  })

  test('preserves canonical member counts in multi-result clan choices', async () => {
    const fake = interaction([], 'Clan')
    const cached = {
      ...clan(observedAt, observedAt),
      members: Array.from({ length: 6 }, (_, index) => ({
        brawlhallaId: index + 1,
        name: `Player ${index + 1}`,
        rank: 'Member',
        joinDate: observedAt,
        xp: '1',
        guildPoints: null,
      })),
    }
    const client = {
      search: {
        local: {
          query: async () => ({
            players: [],
            clans: [
              { clanId: 77, clanName: 'Clan', clanXp: '10', memberCount: 8 },
              { clanId: 88, clanName: 'Clan Two', clanXp: '20', memberCount: 42 },
            ],
          }),
        },
      },
      clan: {
        byId: { query: async () => cached },
        refreshDiscord: {
          mutate: async () => ({ clan: cached, refresh: { outcome: 'notNeeded', retry: { kind: 'none' } } }),
        },
      },
    }

    await createClanCommand({ client: client as never, now: () => Date.parse(observedAt) }).execute(fake.value)

    const json = JSON.stringify(fake.response().components)
    expect(json).toContain('"description":"8 members"')
    expect(json).toContain('"description":"42 members"')
    expect(json).not.toContain('"description":"0 members"')

    let selectedReply: InteractionEditReplyOptions | string | undefined
    const select = {
      id: 'combined-clan-select',
      user: { id: 'discord-user-77' },
      values: ['88'],
      customId: 'clan_select:interaction-77',
      message: { components: fake.response().components ?? [] },
      deferUpdate: async () => {},
      editReply: async (next: InteractionEditReplyOptions | string) => {
        selectedReply = next
        return {} as never
      },
    } as unknown as StringSelectMenuInteraction

    await createClanSelectHandler({ client: client as never, now: () => Date.parse(observedAt) })(select)

    expect(JSON.stringify((selectedReply as InteractionEditReplyOptions).components)).toContain('clan_select')
  })

  test('escapes canonical clan names in embed titles', async () => {
    const fake = interaction([])
    const cached = { ...clan(observedAt, observedAt), clanName: '[verify](https://attacker.example) @everyone' }
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      clan: {
        byId: { query: async () => cached },
        refreshDiscord: {
          mutate: async () => ({ clan: cached, refresh: { outcome: 'notNeeded', retry: { kind: 'none' } } }),
        },
      },
    }

    await createClanCommand({ client: client as never, now: () => Date.parse(observedAt) }).execute(fake.value)

    expect(fake.embed()?.title).toContain('\\[verify]')
    expect(fake.embed()?.title).toContain('@\u200beveryone')
  })

  test('escapes upstream member names inside profile links', async () => {
    const fake = interaction([])
    const cached = {
      ...clan(observedAt, observedAt),
      members: [
        {
          brawlhallaId: 42,
          name: 'Bad](https://attacker.example)',
          rank: 'Member',
          joinDate: observedAt,
          xp: '1',
          guildPoints: null,
        },
      ],
    }
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      clan: {
        byId: { query: async () => cached },
        refreshDiscord: {
          mutate: async () => ({ clan: cached, refresh: { outcome: 'notNeeded', retry: { kind: 'none' } } }),
        },
      },
    }

    await createClanCommand({ client: client as never, now: () => Date.parse(observedAt) }).execute(fake.value)

    expect(fake.embed()?.fields?.[1]?.value).not.toContain('](https://attacker.example)')
  })

  test('keeps stale cached clan data visible with rate-limit retry guidance', async () => {
    const fake = interaction([])
    const cached = clan('2026-08-10T10:00:00.000Z', observedAt)
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      clan: {
        byId: { query: async () => cached },
        refreshDiscord: {
          mutate: async () => ({
            clan: cached,
            refresh: { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 77 } },
          }),
        },
      },
    }

    await createClanCommand({ client: client as never, now: () => Date.parse(observedAt) }).execute(fake.value)

    expect(fake.embed()?.title).toBe('Clan')
    expect(fake.embed()?.description).toContain('Update delayed. Try again')
    expect(fake.embed()?.fields?.[0]?.value).toContain('Profile: Update delayed')
  })

  test('polls already-refreshing clan sections and preserves cache on temporary transport failure', async () => {
    const stale = clan(null, observedAt)
    const fresh = clan('2026-08-10T12:01:00.000Z', observedAt)
    let queries = 0
    const alreadyFake = interaction([])
    const alreadyClient = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      clan: {
        byId: {
          query: async () => {
            queries++
            return fresh
          },
        },
        refreshDiscord: {
          mutate: async () => ({
            clan: stale,
            refresh: {
              outcome: 'alreadyRefreshing',
              operationId: crypto.randomUUID(),
              retry: { kind: 'poll', afterSeconds: 2 },
            },
          }),
        },
      },
    }
    await createClanCommand({
      client: alreadyClient as never,
      wait: async () => {},
      now: () => Date.parse(observedAt),
    }).execute(alreadyFake.value)
    expect(queries).toBe(1)
    expect(alreadyFake.embed()?.fields?.[0]?.value).toContain('Profile: Updated')

    const failedFake = interaction([])
    const failedClient = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      clan: {
        byId: { query: async () => stale },
        refreshDiscord: { mutate: async () => Promise.reject(new Error('temporary failure')) },
      },
    }
    await createClanCommand({
      client: failedClient as never,
      now: () => Date.parse(observedAt),
    }).execute(failedFake.value)
    expect(failedFake.embed()?.title).toBe('Clan')
    expect(failedFake.embed()?.description).toContain('Update delayed. Try again')
  })

  test('keeps non-completing active clan sections visibly refreshing', async () => {
    const fake = interaction([])
    const stale = clan(null, null)
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      clan: {
        byId: { query: async () => stale },
        refreshDiscord: {
          mutate: async () => ({
            clan: stale,
            refresh: {
              outcome: 'alreadyRefreshing',
              operationId: crypto.randomUUID(),
              retry: { kind: 'poll', afterSeconds: 2 },
            },
          }),
        },
      },
    }

    await createClanCommand({
      client: client as never,
      wait: async () => {},
      pollLimit: 1,
      now: () => Date.parse(observedAt),
    }).execute(fake.value)

    expect(fake.embed()?.fields?.[0]?.value).toContain('Profile: Refreshing')
    expect(fake.embed()?.fields?.[0]?.value).toContain('Roster: Refreshing')
  })

  test('does not present an unavailable roster as zero measured members', async () => {
    const fake = interaction([])
    const cached = clan(observedAt, null)
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      clan: {
        byId: { query: async () => cached },
        refreshDiscord: {
          mutate: async () => ({
            clan: cached,
            refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
          }),
        },
      },
    }

    await createClanCommand({ client: client as never, now: () => Date.parse(observedAt) }).execute(fake.value)

    expect(fake.embed()?.fields?.[0]?.value).toContain('**Members**: **Unavailable**')
    expect(fake.embed()?.fields?.some((field) => field.name.startsWith('🏆 Members'))).toBe(false)
  })

  test('acknowledges clan selects before canonical refresh work', async () => {
    const events: string[] = []
    let reply: InteractionEditReplyOptions | string | undefined
    const cached = clan(observedAt, observedAt)
    const value = {
      id: 'clan-select-77',
      user: { id: 'discord-user-77' },
      values: ['77'],
      customId: 'clan_select',
      message: { components: [] },
      deferUpdate: async () => {
        events.push('defer')
      },
      editReply: async (next: InteractionEditReplyOptions | string) => {
        events.push('edit')
        reply = next
        return {} as never
      },
    } as unknown as StringSelectMenuInteraction
    const client = {
      clan: {
        byId: { query: async () => cached },
        refreshDiscord: {
          mutate: async () => {
            events.push('refresh')
            return { clan: cached, refresh: { outcome: 'notNeeded', retry: { kind: 'none' } } }
          },
        },
      },
    }

    await createClanSelectHandler({ client: client as never, now: () => Date.parse(observedAt) })(value)

    expect(events[0]).toBe('defer')
    const embed = (reply as InteractionEditReplyOptions).embeds?.[0]
    const json = embed && 'toJSON' in embed ? embed.toJSON() : embed
    expect(json?.title).toBe('Clan')
  })

  test('does not expose select pagination before a successful roster observation', async () => {
    let reply: InteractionEditReplyOptions | string | undefined
    const unavailableRoster = {
      ...clan(observedAt, null),
      members: Array.from({ length: 6 }, (_, index) => ({
        brawlhallaId: index + 1,
        name: `Player ${index + 1}`,
        rank: 'Member',
        joinDate: observedAt,
        xp: '1',
        guildPoints: null,
      })),
    }
    const value = {
      id: 'clan-select-unavailable-roster',
      user: { id: 'discord-user-77' },
      values: ['77'],
      customId: 'clan_select:origin-interaction',
      message: { components: [] },
      deferUpdate: async () => {},
      editReply: async (next: InteractionEditReplyOptions | string) => {
        reply = next
        return {} as never
      },
    } as unknown as StringSelectMenuInteraction
    const client = {
      clan: {
        byId: { query: async () => unavailableRoster },
        refreshDiscord: {
          mutate: async () => ({
            clan: unavailableRoster,
            refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
          }),
        },
      },
    }

    await createClanSelectHandler({ client: client as never, now: () => Date.parse(observedAt) })(value)

    expect((reply as InteractionEditReplyOptions).components).toEqual([])
  })

  test('terminates safely when an expired pagination interaction cannot be answered', async () => {
    let replies = 0
    const expired = Object.assign(new Error('Unknown interaction'), { code: 10062 })
    const value = {
      customId: 'clan_page:missing:1',
      reply: async () => {
        replies++
        throw expired
      },
    } as unknown as ButtonInteraction

    await expect(handleClanPage(value)).resolves.toBeUndefined()
    expect(replies).toBe(1)
  })

  test('reports unavailable when no canonical clan data exists', async () => {
    const fake = interaction([])
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      clan: {
        byId: { query: async () => null },
        refreshDiscord: {
          mutate: async () => ({
            clan: null,
            refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
          }),
        },
      },
    }

    await createClanCommand({ client: client as never }).execute(fake.value)
    expect(fake.embed()?.title).toBe('❌ Clan Unavailable')
  })
})
