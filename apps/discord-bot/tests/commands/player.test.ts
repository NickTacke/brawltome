import { describe, expect, test } from 'bun:test'
import type { ChatInputCommandInteraction, InteractionEditReplyOptions, StringSelectMenuInteraction } from 'discord.js'
import { createPlayerCommand, createPlayerSelectHandler } from '../../src/commands/player'

const observedAt = '2026-08-10T12:00:00.000Z'

function rankedProfile(freshness: 'fresh' | 'stale' = 'fresh', lastSuccessAt = observedAt) {
  return {
    brawlhallaId: 42,
    checkedAt: observedAt,
    lastSuccessAt,
    freshness,
    freshForSeconds: 3_600,
    sparsePulse: null,
    snapshot: {
      oneVsOne: {
        rating: 0,
        peakRating: 0,
        tier: 'Tin 0',
        wins: 0,
        games: 0,
        region: 'US-E',
        globalRank: null,
        regionRank: null,
      },
      rankedLegends: [],
      mainLegend: null,
      fixedTeams: [],
      soloQueue: [],
      ratingHistory: [],
      observedRatingDirection: null,
    },
  } as const
}

function careerProfile(freshness: 'fresh' | 'stale' = 'fresh') {
  return {
    brawlhallaId: 42,
    checkedAt: observedAt,
    lastSuccessAt: observedAt,
    freshness,
    freshForSeconds: 43_200,
    snapshot: {
      account: { xp: 0, level: 0, xpPercentage: 0 },
      combat: {
        games: 0,
        wins: 0,
        matchTime: 0,
        damageBomb: '0',
        damageMine: '0',
        damageSpikeball: '0',
        damageSidekick: '0',
        snowballHits: 0,
        bombKos: 0,
        mineKos: 0,
        spikeballKos: 0,
        sidekickKos: 0,
        snowballKos: 0,
      },
      legends: [],
      weapons: [],
    },
  } as const
}

function interaction(events: string[], query = 'Ada') {
  let reply: string | InteractionEditReplyOptions | undefined
  return {
    value: {
      id: 'interaction-42',
      user: { id: 'discord-user-42' },
      options: { getString: () => query },
      deferReply: async () => {
        events.push('defer')
      },
      editReply: async (value: string | InteractionEditReplyOptions) => {
        events.push('edit')
        reply = value
        return {} as never
      },
    } as unknown as ChatInputCommandInteraction,
    reply: () => reply as InteractionEditReplyOptions,
  }
}

function commandClient(options: {
  refresh:
    | { outcome: 'accepted' | 'alreadyRefreshing'; operationId: string; retry: { kind: 'poll'; afterSeconds: number } }
    | { outcome: 'rateLimited' | 'temporarilyUnavailable'; retry: { kind: 'after'; afterSeconds: number } }
    | { outcome: 'notNeeded'; retry: { kind: 'none' } }
  reference?: { brawlhallaId: number; name: string } | null
  ranked?: ReturnType<typeof rankedProfile> | null
  career?: ReturnType<typeof careerProfile> | null
  nextRanked?: ReturnType<typeof rankedProfile> | null
  throwRefresh?: boolean
}) {
  let rankedQueries = 0
  let careerQueries = 0
  const reference = options.reference === undefined ? { brawlhallaId: 42, name: 'Ada' } : options.reference
  return {
    value: {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      player: {
        referenceById: { query: async () => reference },
        rankedById: {
          query: async () => {
            rankedQueries++
            return rankedQueries > 1 && options.nextRanked !== undefined ? options.nextRanked : (options.ranked ?? null)
          },
        },
        careerById: {
          query: async () => {
            careerQueries++
            return options.career ?? null
          },
        },
        refreshDiscord: {
          mutate: async () => {
            if (options.throwRefresh) throw new Error('temporary transport failure')
            return { player: reference, refresh: options.refresh }
          },
        },
      },
    },
    rankedQueries: () => rankedQueries,
    careerQueries: () => careerQueries,
  }
}

function embedJson(fake: ReturnType<typeof interaction>) {
  const embed = fake.reply().embeds?.[0]
  return embed && 'toJSON' in embed ? embed.toJSON() : embed
}

describe('/player canonical command', () => {
  test('acknowledges before network work and renders canonical normal state without inventing missing values', async () => {
    const events: string[] = []
    const fake = interaction(events)
    const client = {
      search: {
        local: {
          query: async () => {
            events.push('search')
            return {
              players: [
                {
                  brawlhallaId: 42,
                  name: 'Ada',
                  region: 'US-E',
                  rating: 0,
                  viewCount: 10,
                  bestLegendNameKey: null,
                  matchedAlias: null,
                },
              ],
              clans: [],
            }
          },
        },
      },
      player: {
        referenceById: { query: async () => ({ brawlhallaId: 42, name: 'Ada' }) },
        rankedById: { query: async () => rankedProfile() },
        careerById: { query: async () => careerProfile() },
        refreshDiscord: {
          mutate: async () => ({
            player: { brawlhallaId: 42, name: 'Ada' },
            refresh: { outcome: 'notNeeded', retry: { kind: 'none' } },
          }),
        },
      },
    }

    await createPlayerCommand({ client: client as never }).execute(fake.value)

    expect(events[0]).toBe('defer')
    expect(events).toContain('search')
    const embed = embedJson(fake)
    expect(embed?.title).toBe('Ada')
    expect(embed?.fields?.map((field) => field.name)).toEqual([
      'Competitive Snapshot',
      'Current Season',
      'Career Statistics',
    ])
    expect(embed?.fields?.[0]?.value).toContain('**0** rating')
    expect(JSON.stringify(embed)).not.toContain('player.byId')
  })

  test('escapes canonical player names in embed titles', async () => {
    const fake = interaction([], '42')
    const client = commandClient({
      refresh: { outcome: 'notNeeded', retry: { kind: 'none' } },
      reference: { brawlhallaId: 42, name: '[verify](https://attacker.example) @everyone' },
      ranked: rankedProfile(),
      career: careerProfile(),
    })

    await createPlayerCommand({ client: client.value as never }).execute(fake.value)

    expect(embedJson(fake)?.title).toContain('\\[verify]')
    expect(embedJson(fake)?.title).toContain('@\u200beveryone')
  })

  test('escapes user-controlled Markdown in public not-found output', async () => {
    const fake = interaction([], '[verify](https://attacker.example) @everyone')
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
    }

    await createPlayerCommand({ client: client as never }).execute(fake.value)

    expect(embedJson(fake)?.description).toContain('\\[verify]')
    expect(embedJson(fake)?.description).toContain('@\u200beveryone')
  })

  test('polls only the stale ranked domain for an already-running refresh', async () => {
    const events: string[] = []
    const fake = interaction(events, '42')
    const client = commandClient({
      refresh: {
        outcome: 'alreadyRefreshing',
        operationId: crypto.randomUUID(),
        retry: { kind: 'poll', afterSeconds: 2 },
      },
      ranked: rankedProfile('stale'),
      nextRanked: rankedProfile('fresh', '2026-08-10T12:01:00.000Z'),
      career: careerProfile('fresh'),
    })

    await createPlayerCommand({ client: client.value as never, wait: async () => {} }).execute(fake.value)

    expect(client.rankedQueries()).toBe(2)
    expect(client.careerQueries()).toBe(1)
    expect(embedJson(fake)?.fields?.[1]?.value).toContain('Updated')
    expect(embedJson(fake)?.fields?.[2]?.value).toContain('Updated')
  })

  test('keeps stale cached sections visible when an accepted refresh does not complete in time', async () => {
    const fake = interaction([], '42')
    const client = commandClient({
      refresh: { outcome: 'accepted', operationId: crypto.randomUUID(), retry: { kind: 'poll', afterSeconds: 2 } },
      ranked: rankedProfile('stale'),
      career: careerProfile('stale'),
    })

    await createPlayerCommand({ client: client.value as never, wait: async () => {}, pollLimit: 2 }).execute(fake.value)

    expect(client.rankedQueries()).toBe(3)
    expect(client.careerQueries()).toBe(3)
    expect(embedJson(fake)?.fields?.[1]?.value).toContain('Refreshing')
    expect(embedJson(fake)?.fields?.[2]?.value).toContain('Refreshing')
  })

  test('preserves stale cache and canonical retry guidance when rate limited', async () => {
    const fake = interaction([], '42')
    const client = commandClient({
      refresh: { outcome: 'rateLimited', retry: { kind: 'after', afterSeconds: 77 } },
      ranked: rankedProfile('stale'),
      career: careerProfile('fresh'),
    })

    await createPlayerCommand({ client: client.value as never, now: () => Date.parse(observedAt) }).execute(fake.value)

    expect(embedJson(fake)?.title).toBe('Ada')
    expect(embedJson(fake)?.description).toContain('Update delayed. Try again')
    expect(embedJson(fake)?.fields?.[0]?.value).toContain('**0** rating')
  })

  test('preserves stale cache when the refresh transport is temporarily unavailable', async () => {
    const fake = interaction([], '42')
    const client = commandClient({
      refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
      ranked: rankedProfile('stale'),
      career: careerProfile('fresh'),
      throwRefresh: true,
    })

    await createPlayerCommand({ client: client.value as never, now: () => Date.parse(observedAt) }).execute(fake.value)

    expect(embedJson(fake)?.title).toBe('Ada')
    expect(embedJson(fake)?.description).toContain('Update delayed. Try again')
  })

  test('bounds a never-resolving initial canonical read before interaction expiry', async () => {
    const fake = interaction([], '42')
    let refreshCalls = 0
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      player: {
        referenceById: {
          query: async (_input: unknown, options?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) =>
              options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
                once: true,
              }),
            ),
        },
        rankedById: { query: async () => rankedProfile() },
        careerById: { query: async () => careerProfile() },
        refreshDiscord: {
          mutate: async () => {
            refreshCalls++
            return { player: null, refresh: { outcome: 'notNeeded', retry: { kind: 'none' } } }
          },
        },
      },
    }
    const started = performance.now()

    await createPlayerCommand({ client: client as never, requestTimeoutMs: 1 }).execute(fake.value)

    expect(performance.now() - started).toBeLessThan(100)
    expect(refreshCalls).toBe(0)
    expect(embedJson(fake)?.title).toBe('❌ Error')
  })

  test('preserves cached data when a refresh mutation reaches its request deadline', async () => {
    const fake = interaction([], '42')
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      player: {
        referenceById: { query: async () => ({ brawlhallaId: 42, name: 'Ada' }) },
        rankedById: { query: async () => rankedProfile('stale') },
        careerById: { query: async () => careerProfile() },
        refreshDiscord: {
          mutate: async (_input: unknown, options?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) =>
              options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
                once: true,
              }),
            ),
        },
      },
    }

    await createPlayerCommand({ client: client as never, requestTimeoutMs: 1 }).execute(fake.value)

    expect(embedJson(fake)?.title).toBe('Ada')
    expect(embedJson(fake)?.description).toContain('Update delayed. Try again')
  })

  test('bounds a never-resolving poll query and keeps active state visible', async () => {
    const fake = interaction([], '42')
    let rankedQueries = 0
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      player: {
        referenceById: { query: async () => ({ brawlhallaId: 42, name: 'Ada' }) },
        rankedById: {
          query: async (_input: unknown, options?: { signal?: AbortSignal }) => {
            rankedQueries++
            if (rankedQueries === 1) return rankedProfile('stale')
            return new Promise((_resolve, reject) =>
              options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
                once: true,
              }),
            )
          },
        },
        careerById: { query: async () => careerProfile() },
        refreshDiscord: {
          mutate: async () => ({
            player: { brawlhallaId: 42, name: 'Ada' },
            refresh: {
              outcome: 'accepted',
              operationId: crypto.randomUUID(),
              retry: { kind: 'poll', afterSeconds: 2 },
            },
          }),
        },
      },
    }

    await createPlayerCommand({ client: client as never, wait: async () => {}, requestTimeoutMs: 1 }).execute(
      fake.value,
    )

    expect(rankedQueries).toBe(2)
    expect(embedJson(fake)?.fields?.[1]?.value).toContain('Refreshing')
  })

  test('stops before network work when acknowledgement has already expired', async () => {
    let networkCalls = 0
    const expired = Object.assign(new Error('Unknown interaction'), { code: 10062 })
    const value = {
      id: 'expired-interaction',
      user: { id: 'discord-user-42' },
      options: { getString: () => '42' },
      deferReply: async () => Promise.reject(expired),
      editReply: async () => {
        throw new Error('must not edit')
      },
    } as unknown as ChatInputCommandInteraction
    const client = {
      search: { local: { query: async () => ({ players: [], clans: [] }) } },
      player: {
        referenceById: {
          query: async () => {
            networkCalls++
            return null
          },
        },
      },
    }

    await expect(createPlayerCommand({ client: client as never }).execute(value)).resolves.toBeUndefined()
    expect(networkCalls).toBe(0)
  })

  test('does not retry a final response after the interaction webhook expires', async () => {
    let edits = 0
    const expired = Object.assign(new Error('Unknown webhook'), { code: 10015 })
    const value = {
      id: 'expiring-interaction',
      user: { id: 'discord-user-42' },
      options: { getString: () => '42' },
      deferReply: async () => {},
      editReply: async () => {
        edits++
        throw expired
      },
    } as unknown as ChatInputCommandInteraction
    const client = commandClient({
      refresh: { outcome: 'notNeeded', retry: { kind: 'none' } },
      ranked: rankedProfile(),
      career: careerProfile(),
    })

    await expect(createPlayerCommand({ client: client.value as never }).execute(value)).resolves.toBeUndefined()
    expect(edits).toBe(1)
  })

  test('uses canonical reads and refresh for player select interactions', async () => {
    const events: string[] = []
    let reply: InteractionEditReplyOptions | string | undefined
    const value = {
      id: 'player-select-42',
      user: { id: 'discord-user-42' },
      values: ['42'],
      customId: 'player_select',
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
    const client = commandClient({
      refresh: { outcome: 'notNeeded', retry: { kind: 'none' } },
      ranked: rankedProfile(),
      career: careerProfile(),
    })

    await createPlayerSelectHandler({ client: client.value as never })(value)

    expect(events[0]).toBe('defer')
    const embed = (reply as InteractionEditReplyOptions).embeds?.[0]
    const json = embed && 'toJSON' in embed ? embed.toJSON() : embed
    expect(json?.fields?.map((field) => field.name)).toEqual([
      'Competitive Snapshot',
      'Current Season',
      'Career Statistics',
    ])
  })

  test('reports unavailable without inventing a profile when no canonical data exists', async () => {
    const fake = interaction([], '42')
    const client = commandClient({
      refresh: { outcome: 'temporarilyUnavailable', retry: { kind: 'after', afterSeconds: 30 } },
      reference: null,
      ranked: null,
      career: null,
    })

    await createPlayerCommand({ client: client.value as never }).execute(fake.value)

    expect(embedJson(fake)?.title).toBe('❌ Player Unavailable')
    expect(embedJson(fake)?.description).toContain('Try again')
  })
})
