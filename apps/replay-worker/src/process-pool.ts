import { join } from 'node:path'
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
}

export type PlayAnswer =
  | { kind: 'line'; raw: string }
  | { kind: 'failure'; code: 'patch-not-supported' | 'worker-error'; message: string }

type Slot = { gameFolder: string; process: Promise<BhnativeProcess>; inFlight: number }

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
      Array.from({ length: count }, (): Slot => {
        const gameFolder = join(config.gameRoot, patch)

        return { gameFolder, process: BhnativeProcess.start(config.command, gameFolder), inFlight: 0 }
      }),
    )

    const pool = new ProcessPool(config, groups)

    await Promise.all(groups.flat().map((slot) => slot.process))
    for (const slot of groups.flat()) pool.restartWhenExited(slot)

    return pool
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

  /** What the worker tells the api when it claims: its bh-native build and the patches its processes answered for. */
  report(): { build: string; patches: string[] } {
    const patches = new Set<string>()

    for (const slot of this.groups.flat()) {
      const known = Bun.peek(slot.process)

      if (known instanceof BhnativeProcess && known.patch) patches.add(known.patch)
    }

    return { build: this.config.build, patches: [...patches] }
  }

  async close(): Promise<void> {
    this.isClosing = true

    for (const slot of this.groups.flat()) (await slot.process.catch(() => null))?.close()
  }

  private async playOn(group: Slot[], replayPath: string) {
    const slot = group.reduce((least, candidate) => (candidate.inFlight < least.inFlight ? candidate : least))

    slot.inFlight += 1

    try {
      return { kind: 'answer' as const, ...(await (await slot.process).play(replayPath)) }
    } catch (error) {
      return { kind: 'failure' as const, code: 'worker-error' as const, message: String(error).slice(0, 500) }
    } finally {
      slot.inFlight -= 1
    }
  }

  // a process that dies is started again in its slot; replays waiting on it already failed with worker-error
  private restartWhenExited(slot: Slot): void {
    void slot.process.then(async (process) => {
      await process.exited
      if (this.isClosing) return

      slot.process = BhnativeProcess.start(this.config.command, slot.gameFolder)
      this.restartWhenExited(slot)
    })
  }
}
