// the brawlhalla-anims export bundle, run as a child process: `plan`, `render` and `warm` (see "Export format" in its
// README). Each run is one process, which is killed once it runs out of the time it was given or its signal aborts

// stopped: killed because its signal aborted
export type ExportRun =
  | { kind: 'exited'; exitCode: number; stdout: string; stderr: string }
  | { kind: 'timed-out'; timeoutMs: number }
  | { kind: 'stopped' }

export type RunOptions = { timeoutMs: number; signal?: AbortSignal }

export type Exporter = { run(args: string[], options: RunOptions): Promise<ExportRun> }

export type ExporterConfig = {
  // the bundle's own node with its heap cap, then scripts/export.ts
  command: string[]
}

/** The node command that runs the bundle at animsPath. */
export function exportCommand(animsPath: string): string[] {
  // a 2v2 render peaks near 1.2 GB; the cap stops a runaway one before it takes the game processes' memory
  return [`${animsPath}/node/bin/node`, '--max-old-space-size=3072', `${animsPath}/scripts/export.ts`]
}

export function createExporter(config: ExporterConfig): Exporter {
  return {
    async run(args, options) {
      const child = Bun.spawn([...config.command, ...args], { stdout: 'pipe', stderr: 'pipe' })
      let ending: 'timed-out' | 'stopped' | null = null

      const kill = (reason: 'timed-out' | 'stopped') => {
        ending ??= reason
        child.kill('SIGKILL')
      }

      const timer = setTimeout(() => kill('timed-out'), options.timeoutMs)
      const stop = () => kill('stopped')

      if (options.signal?.aborted) stop()

      options.signal?.addEventListener('abort', stop, { once: true })

      try {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])

        if (ending === 'timed-out') return { kind: 'timed-out', timeoutMs: options.timeoutMs }

        if (ending === 'stopped') return { kind: 'stopped' }

        return { kind: 'exited', exitCode, stdout, stderr }
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', stop)
      }
    },
  }
}
