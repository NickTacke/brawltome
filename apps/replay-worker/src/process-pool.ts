import { basename, join } from 'node:path'
import { BhnativeProcess } from './bhnative-process'
import { listPatches } from './game-folders'

// the bh-native processes the worker plays replays on: a few for the newest patch, which nearly every replay is
// from, and one for the previous patch, for replays recorded just before an update

export type PoolConfig = {
  command: string[]
  gameRoot: string
  newestProcesses: number
  previousProcesses: number
  build: string
  // a replay with no answer by then fails, and its process is replaced
  replayTimeoutMs: number
  // how long to wait before starting a process again after it failed to start
  restartDelayMs: number
}

export type PlayAnswer =
  | { kind: 'line'; raw: string }
  | { kind: 'failure'; code: 'patch-not-supported' | 'worker-error'; message: string }

type Slot = { gameFolder: string; live: BhnativeProcess | null; inFlight: number }

type RawAnswer =
  | { kind: 'answer'; exit: number; raw: string; replayVersion?: string }
  | Extract<PlayAnswer, { kind: 'failure' }>

export class ProcessPool {
  private isClosing = false

  private constructor(
    private readonly config: PoolConfig,
    // newest patch first; each group is the slots of one patch folder
    private readonly groups: Slot[][],
  ) {}

  static async start(config: PoolConfig): Promise<ProcessPool> {
    const [newest, previous] = listPatches(config.gameRoot)

    if (!newest) throw new Error(`no game folders in ${config.gameRoot}`)

    const plan: [string, number][] = [[newest, config.newestProcesses]]

    if (previous && config.previousProcesses > 0) plan.push([previous, config.previousProcesses])

    const groups = plan.map(([patch, count]) =>
      Array.from(
        { length: count },
        (): Slot => ({ gameFolder: join(config.gameRoot, patch), live: null, inFlight: 0 }),
      ),
    )

    const pool = new ProcessPool(config, groups)

    await Promise.all(
      groups.flat().map(async (slot) => {
        pool.watch(slot, await BhnativeProcess.start(config.command, slot.gameFolder))
      }),
    )

    return pool
  }

  /** Whether a process for the newest patch is running; the worker claims nothing while none is. */
  isReady(): boolean {
    return this.groups[0]?.some((slot) => slot.live !== null) ?? false
  }

  /** Plays a replay on the newest patch, and on the previous one when bh-native says it's from there. */
  async play(replayPath: string): Promise<PlayAnswer> {
    let lastVersion = 'unknown'

    for (const group of this.groups) {
      const answer = await this.playOn(group, replayPath)

      if (answer.kind === 'failure') return answer

      if (answer.exit !== 3) return { kind: 'line', raw: answer.raw }

      lastVersion = answer.replayVersion ?? lastVersion
    }

    return {
      kind: 'failure',
      code: 'patch-not-supported',
      message: `no game folder plays replay version ${lastVersion}`,
    }
  }

  /**
   * What the worker tells the api when it claims: its bh-native build and the patches it runs. A process that hasn't
   * answered yet counts by its folder's name, so a restarted worker still reports the patch it can play.
   */
  report(): { build: string; patches: string[] } {
    const patches = new Set<string>()

    for (const slot of this.groups.flat()) {
      if (slot.live) patches.add(slot.live.patch ?? basename(slot.gameFolder))
    }

    return { build: this.config.build, patches: [...patches] }
  }

  close(): void {
    this.isClosing = true

    for (const slot of this.groups.flat()) slot.live?.close()
  }

  private async playOn(group: Slot[], replayPath: string): Promise<RawAnswer> {
    const running = group.filter((slot) => slot.live !== null)

    if (running.length === 0)
      return { kind: 'failure', code: 'worker-error', message: 'no bh-native process is running' }

    const slot = running.reduce((least, candidate) => (candidate.inFlight < least.inFlight ? candidate : least))
    const process = slot.live as BhnativeProcess

    slot.inFlight += 1

    try {
      const answer = await process.play(replayPath, this.config.replayTimeoutMs)

      if (answer === 'timed-out') {
        // the process killed itself; out of the slot at once, so nothing more is sent to it, and its exit starts a
        // fresh one
        if (slot.live === process) slot.live = null

        return { kind: 'failure', code: 'worker-error', message: `no answer within ${this.config.replayTimeoutMs} ms` }
      }

      return { kind: 'answer', ...answer }
    } catch (error) {
      return { kind: 'failure', code: 'worker-error', message: String(error).slice(0, 500) }
    } finally {
      slot.inFlight -= 1
    }
  }

  // puts a running process in its slot and starts a new one when it exits
  private watch(slot: Slot, process: BhnativeProcess): void {
    slot.live = process

    void process.exited.then(() => {
      slot.live = null
      if (!this.isClosing) void this.restart(slot)
    })
  }

  private async restart(slot: Slot): Promise<void> {
    while (!this.isClosing) {
      try {
        this.watch(slot, await BhnativeProcess.start(this.config.command, slot.gameFolder))

        return
      } catch (error) {
        console.error(`bh-native for ${slot.gameFolder} didn't start again:`, error)
        await Bun.sleep(this.config.restartDelayMs)
      }
    }
  }
}
