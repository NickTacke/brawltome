// the brawlhalla-anims export bundle, run as a child process: `plan`, `render` and `warm` (see "Export format" in its
// README). Each run is one process, which is killed once it runs out of time

export type ExportRun =
  | { kind: 'exited'; exitCode: number; stdout: string; stderr: string }
  | { kind: 'timed-out'; timeoutMs: number }

export type Exporter = { run(args: string[]): Promise<ExportRun> }

export type ExporterConfig = {
  // the bundle's own node with its heap cap, then scripts/export.ts
  command: string[]
  exportTimeoutMs: number
}

/** The node command that runs the bundle at animsPath. */
export function exportCommand(animsPath: string): string[] {
  // a 2v2 render peaks near 1.2 GB; the cap stops a runaway one before it takes the game processes' memory
  return [`${animsPath}/node/bin/node`, '--max-old-space-size=3072', `${animsPath}/scripts/export.ts`]
}

export function createExporter(config: ExporterConfig): Exporter {
  return {
    async run(args) {
      const child = Bun.spawn([...config.command, ...args], { stdout: 'pipe', stderr: 'pipe' })
      let isTimedOut = false

      const timer = setTimeout(() => {
        isTimedOut = true
        child.kill('SIGKILL')
      }, config.exportTimeoutMs)

      try {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])

        if (isTimedOut) return { kind: 'timed-out', timeoutMs: config.exportTimeoutMs }

        return { kind: 'exited', exitCode, stdout, stderr }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
