import type { Subprocess } from 'bun'

// one `bhnative replay <game folder> --stdin` process: it starts the game once, then answers each replay path it
// reads on stdin with one JSON line on stdout, in order

const READY_TEXT = 'the game has started'

export type ReplayAnswer = {
  exit: number
  patch?: string
  replayVersion?: string
  gameVersion?: string
  raw: string
}

type Waiter = { resolve: (line: string) => void; reject: (error: Error) => void }

export class BhnativeProcess {
  // what the process said about its own game, learned from its answers
  patch: string | null = null
  gameVersion: string | null = null
  isAlive = true
  readonly exited: Promise<number>

  private readonly waiters: Waiter[] = []
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly child: Subprocess<'pipe', 'pipe', 'pipe'>,
    readonly gameFolder: string,
  ) {
    this.exited = child.exited.then((code) => {
      this.isAlive = false

      for (const waiter of this.waiters.splice(0)) waiter.reject(new Error(`bhnative exited with ${code}`))

      return code
    })
  }

  /** Starts the game and resolves once it says it's ready; rejects if it exits or takes longer than readyTimeoutMs. */
  static async start(command: string[], gameFolder: string, readyTimeoutMs = 300_000): Promise<BhnativeProcess> {
    const child = Bun.spawn([...command, 'replay', gameFolder, '--stdin'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    })

    const started = new BhnativeProcess(child, gameFolder)
    const ready = waitForReady(child.stderr, gameFolder)

    const timeout = Bun.sleep(readyTimeoutMs).then(() => {
      throw new Error(`bhnative for ${gameFolder} wasn't ready after ${readyTimeoutMs} ms`)
    })

    const exitedEarly = started.exited.then((code) => {
      throw new Error(`bhnative for ${gameFolder} exited with ${code} before it was ready`)
    })

    try {
      await Promise.race([ready, timeout, exitedEarly])
    } catch (error) {
      child.kill()
      throw error
    }

    started.readAnswers()

    return started
  }

  /**
   * Plays one replay; calls are answered one at a time, in the order they were made. The timeout starts when the
   * replay reaches the game, not while it waits behind others; a replay that runs out of time kills the process.
   */
  play(replayPath: string, timeoutMs: number): Promise<ReplayAnswer | 'timed-out'> {
    const answer = this.queue.then(() => this.send(replayPath, timeoutMs))

    this.queue = answer.catch(() => undefined)

    return answer
  }

  close(): void {
    this.child.kill()
  }

  private async send(replayPath: string, timeoutMs: number): Promise<ReplayAnswer | 'timed-out'> {
    if (!this.isAlive) throw new Error('bhnative is no longer running')

    const line = new Promise<string>((resolve, reject) => this.waiters.push({ resolve, reject }))

    this.child.stdin.write(`${replayPath}\n`)
    await this.child.stdin.flush()

    const answer = await withTimeout(line, timeoutMs)

    if (answer !== 'timed-out') return this.learnFrom(answer)

    // a game stuck in a loop never answers; killed at once, so the replays queued behind it fail fast instead of
    // waiting on it, and a late line can't be taken for theirs
    this.isAlive = false
    this.close()

    return 'timed-out'
  }

  private learnFrom(raw: string): ReplayAnswer {
    const parsed = JSON.parse(raw) as {
      exit: number
      patch?: string
      replayVersion?: string
      gameVersion?: string
      stats?: { ReplayVersion?: number }
    }

    if (parsed.exit === 0 && parsed.patch) {
      this.patch = parsed.patch
      if (parsed.stats?.ReplayVersion !== undefined) this.gameVersion = String(parsed.stats.ReplayVersion)
    }

    if (parsed.exit === 3 && parsed.gameVersion) this.gameVersion = String(parsed.gameVersion)

    return {
      exit: parsed.exit,
      patch: parsed.patch,
      replayVersion: parsed.replayVersion === undefined ? undefined : String(parsed.replayVersion),
      gameVersion: parsed.gameVersion === undefined ? undefined : String(parsed.gameVersion),
      raw,
    }
  }

  private async readAnswers(): Promise<void> {
    for await (const line of lines(this.child.stdout)) this.waiters.shift()?.resolve(line)
  }
}

async function waitForReady(stderr: ReadableStream<Uint8Array>, gameFolder: string): Promise<void> {
  // stepped by hand: leaving a for-await would ask the reader to close, and that request waits behind the drain
  // below, which never finishes
  const reader = lines(stderr)

  for (;;) {
    const { value, done } = await reader.next()

    if (done) throw new Error(`bhnative for ${gameFolder} closed its log before it was ready`)

    if (value.includes(READY_TEXT)) break
  }

  // keep reading, so a full stderr pipe never blocks the game; its notes go to the worker's log
  void (async () => {
    for await (const line of reader) console.error(`bhnative ${gameFolder}: ${line}`)
  })()
}

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffered = ''

  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true })

    let newline = buffered.indexOf('\n')

    while (newline !== -1) {
      const line = buffered.slice(0, newline).trim()

      buffered = buffered.slice(newline + 1)
      if (line) yield line

      newline = buffered.indexOf('\n')
    }
  }
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T | 'timed-out'> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => resolve('timed-out'), timeoutMs)
  })

  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}
