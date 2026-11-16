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

// isParked: stopped by limitTo, so nothing plays on it and it isn't started again until unlimit
type Slot = {
  gameFolder: string
  live: BhnativeProcess | null
  inFlight: number
  isParked: boolean
  isRestarting: boolean
}

const IDLE_POLL_MS = 50
// as long as a game may take to say it's ready
const RESTART_WAIT_MS = 300_000

type RawAnswer =
  | { kind: 'answer'; exit: number; raw: string; replayVersion?: string }
  | Extract<PlayAnswer, { kind: 'failure' }>

export class ProcessPool {
  private isClosing = false
  // resolves when the current limit lifts
  private limitLifted: Promise<void> = Promise.resolve()
  private liftLimit: () => void = () => undefined

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
        (): Slot => ({
          gameFolder: join(config.gameRoot, patch),
          live: null,
          inFlight: 0,
          isParked: false,
          isRestarting: false,
        }),
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
      await this.untilUsable(group)

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

    // a process stopped by the limit still counts: it starts again once the limit lifts
    for (const slot of this.groups.flat()) {
      if (slot.live || slot.isParked) patches.add(slot.live?.patch ?? basename(slot.gameFolder))
    }

    return { build: this.config.build, patches: [...patches] }
  }

  /** How many bh-native processes are running now. */
  runningCount(): number {
    return this.groups.flat().filter((slot) => slot.live !== null).length
  }

  /**
   * Stops every process past the first count, newest patch first, once the replays it was given are answered, so an
   * art export has the memory. A replay for a patch left with no process waits until unlimit.
   */
  async limitTo(count: number): Promise<void> {
    const stopped = this.groups.flat().slice(count)

    this.limitLifted = new Promise((resolve) => {
      this.liftLimit = resolve
    })

    for (const slot of stopped) slot.isParked = true

    await Promise.all(stopped.map((slot) => this.stopWhenIdle(slot)))
  }

  /** Starts the processes limitTo stopped again. */
  unlimit(): void {
    for (const slot of this.groups.flat()) {
      if (!slot.isParked) continue

      slot.isParked = false
      if (slot.live === null && !slot.isRestarting) void this.restart(slot)
    }

    this.liftLimit()
  }

  close(): void {
    this.isClosing = true

    for (const slot of this.groups.flat()) slot.live?.close()
  }

  private async playOn(group: Slot[], replayPath: string): Promise<RawAnswer> {
    const running = group.filter((slot) => slot.live !== null && !slot.isParked)

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

  // a group the limit stopped entirely waits for the limit to lift and one of its processes to start again
  private async untilUsable(group: Slot[]): Promise<void> {
    if (!group.every((slot) => slot.isParked)) return

    await this.limitLifted

    for (let waitedMs = 0; waitedMs < RESTART_WAIT_MS; waitedMs += IDLE_POLL_MS) {
      if (this.isClosing || group.some((slot) => slot.live !== null)) return

      await Bun.sleep(IDLE_POLL_MS)
    }
  }

  private async stopWhenIdle(slot: Slot): Promise<void> {
    while (slot.inFlight > 0) await Bun.sleep(IDLE_POLL_MS)

    const process = slot.live

    // the limit may have lifted while the last replay played
    if (!process || !slot.isParked) return

    process.close()
    await process.exited
  }

  // puts a running process in its slot and starts a new one when it exits, unless the limit stopped it
  private watch(slot: Slot, process: BhnativeProcess): void {
    slot.live = process

    void process.exited.then(() => {
      slot.live = null
      if (!this.isClosing && !slot.isParked) void this.restart(slot)
    })
  }

  private async restart(slot: Slot): Promise<void> {
    slot.isRestarting = true

    while (!this.isClosing && !slot.isParked) {
      if (await this.startIn(slot)) break

      await Bun.sleep(this.config.restartDelayMs)
    }

    slot.isRestarting = false
  }

  // whether a process started and took the slot. one that starts after the limit stopped the slot is closed again at
  // once, and the loop above starts another should the limit lift meanwhile
  private async startIn(slot: Slot): Promise<boolean> {
    try {
      const process = await BhnativeProcess.start(this.config.command, slot.gameFolder)

      if (slot.isParked) {
        process.close()

        return false
      }

      this.watch(slot, process)

      return true
    } catch (error) {
      console.error(`bh-native for ${slot.gameFolder} didn't start again:`, error)

      return false
    }
  }
}
