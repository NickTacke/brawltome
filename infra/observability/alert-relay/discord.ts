// Minimal Discord webhook client: post (with ?wait=true to learn the message id) and edit in place. Retries 429s
// after the advertised delay and 5xx/network failures with backoff. The webhook URL carries its token, so it never
// appears in errors or logs.

export type AllowedMentions = { parse: Array<'everyone' | 'users' | 'roles'>; users?: string[]; roles?: string[] }

export type Embed = {
  title?: string
  url?: string
  description?: string
  color?: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  timestamp?: string
  footer?: { text: string }
}

export type MessageBody = {
  content?: string
  embeds?: Embed[]
  allowed_mentions: AllowedMentions
  flags?: number
}

// Delivers the message without a push or desktop notification.
export const SUPPRESS_NOTIFICATIONS = 1 << 12

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export type DiscordClientOptions = {
  webhookUrl: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  log?: (level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void
  maxRateLimitRetries?: number
  maxFailureRetries?: number
}

export class DiscordClient {
  private readonly fetch: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly log: NonNullable<DiscordClientOptions['log']>
  private readonly maxRateLimitRetries: number
  private readonly maxFailureRetries: number

  constructor(private readonly options: DiscordClientOptions) {
    this.fetch = options.fetch ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.log = options.log ?? (() => {})
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 10
    this.maxFailureRetries = options.maxFailureRetries ?? 4
  }

  async post(body: MessageBody): Promise<string> {
    const url = new URL(this.options.webhookUrl)
    url.searchParams.set('wait', 'true')
    const response = await this.send('POST', url, body)
    const message = (await response.json()) as { id?: unknown }
    if (typeof message.id !== 'string') throw new DiscordError(response.status, 'Discord response had no message id')
    return message.id
  }

  // Returns false when the message no longer exists, so the caller can post a replacement.
  async edit(messageId: string, body: MessageBody): Promise<boolean> {
    const url = new URL(this.options.webhookUrl)
    url.pathname = `${url.pathname.replace(/\/$/, '')}/messages/${encodeURIComponent(messageId)}`
    // Edits may only toggle SUPPRESS_EMBEDS, so creation-only flags are dropped.
    const { flags: _flags, ...edit } = body
    try {
      await this.send('PATCH', url, edit)
      return true
    } catch (error) {
      if (error instanceof DiscordError && error.status === 404) return false
      throw error
    }
  }

  private async send(
    method: 'POST' | 'PATCH',
    url: URL,
    body: Omit<MessageBody, 'flags'> & { flags?: number },
  ): Promise<Response> {
    let rateLimited = 0
    let failed = 0
    for (;;) {
      let response: Response
      try {
        response = await this.fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        })
      } catch {
        failed++
        if (failed > this.maxFailureRetries) throw new DiscordError(0, `Discord ${method} failed: network error`)
        const delay = backoff(failed)
        this.log('warn', 'discord request failed, retrying', { method, reason: 'network', delayMs: delay })
        await this.sleep(delay)
        continue
      }

      if (response.ok) return response
      if (response.status === 429) {
        rateLimited++
        const delay = await retryAfterMs(response)
        if (rateLimited > this.maxRateLimitRetries) throw new DiscordError(429, `Discord ${method} stayed rate limited`)
        this.log('warn', 'discord rate limited, retrying', { method, delayMs: delay })
        await this.sleep(delay)
        continue
      }
      if (response.status >= 500) {
        failed++
        if (failed > this.maxFailureRetries) {
          throw new DiscordError(response.status, `Discord ${method} failed with ${response.status}`)
        }
        const delay = backoff(failed)
        this.log('warn', 'discord request failed, retrying', { method, status: response.status, delayMs: delay })
        await this.sleep(delay)
        continue
      }
      // Other 4xx responses will not succeed on retry. The body explains why, without echoing the token.
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      throw new DiscordError(response.status, `Discord ${method} rejected with ${response.status}: ${detail}`)
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(1_000 * 2 ** (attempt - 1), 30_000)
}

async function retryAfterMs(response: Response): Promise<number> {
  let seconds: number | undefined
  try {
    const body = (await response.json()) as { retry_after?: unknown }
    if (typeof body.retry_after === 'number') seconds = body.retry_after
  } catch {}
  if (seconds === undefined) {
    const header = Number(response.headers.get('retry-after'))
    if (Number.isFinite(header)) seconds = header
  }
  // A small margin past the advertised reset avoids hitting the same bucket again.
  return Math.min(Math.max((seconds ?? 1) * 1_000, 0) + 100, 60_000)
}

// Turns DISCORD_PAGE_MENTION into the allowed_mentions that let exactly that mention ping.
export function pageMentions(mention: string): AllowedMentions {
  const users = [...mention.matchAll(/<@!?(\d+)>/g)].map((match) => match[1] as string)
  const roles = [...mention.matchAll(/<@&(\d+)>/g)].map((match) => match[1] as string)
  return {
    parse: /@(everyone|here)\b/.test(mention) ? ['everyone'] : [],
    ...(users.length > 0 ? { users } : {}),
    ...(roles.length > 0 ? { roles } : {}),
  }
}

export const noMentions: AllowedMentions = { parse: [] }
