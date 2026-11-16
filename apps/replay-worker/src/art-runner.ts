import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type ArtClient,
  type ArtFailureCode,
  type ArtJob,
  ArtRefusedError,
  type ArtResult,
  type ClaimedArt,
  LeaseLostError,
} from './art-client'
import type { Exporter } from './art-export'
import {
  type JobFiles,
  jobFiles,
  listStore,
  readStoreMaps,
  removeJobFiles,
  writeHave,
  writeStoreFile,
} from './art-files'
import type { ProcessPool } from './process-pool'

// beside the parse loop: claims an art job, has the export plan and draw only what the art bucket lacks, sends the
// new files through the api, then the manifest. a warm job draws a patch's base looks and maps instead of a match

export type ArtRunnerDeps = {
  art: ArtClient
  pool: Pick<ProcessPool, 'report' | 'limitTo' | 'unlimit'>
  exporter: Exporter
  // the game folder of a patch is <gameRoot>/<patch>, as for the parse processes
  gameRoot: string
  workDir: string
  artFormat: number
  // bh-native processes left running while the export draws
  processesDuringArt: number
  renewEveryMs: number
  // how long a plan or render may take, and how long a warm may
  exportTimeoutMs: number
  warmTimeoutMs: number
}

type Failure = { kind: 'failure'; code: ArtFailureCode; message: string }
type Outcome = { kind: 'result'; result: ArtResult } | Failure
type StepOutput = { kind: 'done'; stdout: string } | Failure

// what the runner reads of the export's plan (ExportPlan in the export's scripts/export-plan.ts)
type ExportPlan = { patch: string; mapId: number; groups: { path: string }[]; map: { path: string } }

export class ArtRunner {
  constructor(private readonly deps: ArtRunnerDeps) {}

  /** Claims one art job, exports its art and answers; 'idle' when the api had nothing to do. */
  async runOnce(): Promise<'idle' | 'done'> {
    const job = await this.deps.art.claim({ ...this.deps.pool.report(), artFormat: this.deps.artFormat })

    if (!job) return 'idle'

    const artDir = join(this.deps.workDir, 'art')

    const renewal = setInterval(() => {
      this.deps.art.renew(job).catch((error: unknown) => console.error(`renew art job ${job.jobId}:`, error))
    }, this.deps.renewEveryMs)

    try {
      await this.attempt(job, jobFiles(artDir, job.jobId))
    } finally {
      clearInterval(renewal)
      removeJobFiles(artDir, job.jobId)
    }

    return 'done'
  }

  private async attempt(job: ClaimedArt, files: JobFiles): Promise<void> {
    try {
      const outcome = await this.exportArt(job, files)

      if (outcome.kind === 'result') await this.deps.art.result(job, outcome.result)
      else await this.deps.art.failure(job, outcome.code, outcome.message)
    } catch (error) {
      console.error(`art job ${job.jobId}:`, error)

      // another attempt owns the job now
      if (error instanceof LeaseLostError) return

      const code = error instanceof ArtRefusedError ? 'export-failed' : 'worker-error'

      await this.deps.art.failure(job, code, String(error).slice(0, 500))
    }
  }

  private async exportArt(job: ClaimedArt, files: JobFiles): Promise<Outcome> {
    const gameFolder = join(this.deps.gameRoot, job.patch)

    // the patch names a folder, so it must look like one (11.00)
    if (!/^\d+(\.\d+)*$/.test(job.patch) || !existsSync(gameFolder)) {
      return failure('export-failed', `the worker has no game folder for patch ${job.patch}`)
    }

    mkdirSync(files.store, { recursive: true })

    if (job.kind === 'warm') return this.exportWarm(job, gameFolder, files)

    return this.exportMatch(job, gameFolder, files)
  }

  private async exportMatch(job: ClaimedArt, gameFolder: string, files: JobFiles): Promise<Outcome> {
    writeFileSync(files.line, job.line ?? new Uint8Array())

    const planned = await this.step(['plan', gameFolder, files.line])

    if (planned.kind === 'failure') return planned

    const plan = JSON.parse(planned.stdout) as ExportPlan
    const present = await this.presentOf(job, [...plan.groups.map((group) => group.path), plan.map.path])

    // the render reads the art groups and map file it doesn't draw again, to name their sheets; it needs no sheets
    await this.download(job, present, files.store)
    writeHave(files, present)

    const outputArgs = ['--have', files.have, '--manifest', files.manifest]
    const renderArgs = ['render', gameFolder, files.line, files.store, ...outputArgs]
    const rendered = await this.whileLimited(() => this.step(renderArgs))

    if (rendered.kind === 'failure') return rendered

    await this.upload(job, files.store, present)

    const manifest = JSON.parse(readFileSync(files.manifest, 'utf8')) as Record<string, unknown>
    const maps = [{ patch: plan.patch, mapId: plan.mapId, path: plan.map.path }]

    return { kind: 'result', result: { manifest, maps, artFormat: this.deps.artFormat } }
  }

  private async exportWarm(job: ClaimedArt, gameFolder: string, files: JobFiles): Promise<Outcome> {
    const warmArgs = ['warm', gameFolder, files.store, '--patch', job.patch]
    const listed = await this.step([...warmArgs, '--list'])

    if (listed.kind === 'failure') return listed

    const present = await this.presentOf(job, listed.stdout.split('\n').filter(Boolean))

    // the result names every map file of the patch, so those already stored come down to tell their map ids
    const storedMaps = present.filter((path) => path.startsWith('maps/'))

    await this.download(job, storedMaps, files.store)
    writeHave(files, present)

    const warmHaveArgs = [...warmArgs, '--have', files.have]
    const warmed = await this.whileLimited(() => this.step(warmHaveArgs, this.deps.warmTimeoutMs))

    if (warmed.kind === 'failure') return warmed

    await this.upload(job, files.store, present)

    const maps = readStoreMaps(files.store)

    return { kind: 'result', result: { manifest: null, maps, artFormat: this.deps.artFormat } }
  }

  // the paths the art bucket already holds
  private async presentOf(job: ArtJob, paths: string[]): Promise<string[]> {
    const missing = new Set(await this.deps.art.missing(job, paths))

    return paths.filter((path) => !missing.has(path))
  }

  private async download(job: ArtJob, paths: string[], store: string): Promise<void> {
    for (const path of paths) writeStoreFile(store, path, await this.deps.art.readFile(job, path))
  }

  // sends what the export wrote that the bucket still lacks: a sheet shared with another match may be there already
  private async upload(job: ArtJob, store: string, downloaded: string[]): Promise<void> {
    const downloadedPaths = new Set(downloaded)
    const written = listStore(store).filter((path) => !downloadedPaths.has(path))

    for (const path of await this.deps.art.missing(job, written)) {
      await this.deps.art.putFile(job, path, readFileSync(join(store, path)))
    }
  }

  // drawing takes memory the game processes would otherwise use, so only a few of them run meanwhile
  private async whileLimited<T>(work: () => Promise<T>): Promise<T> {
    await this.deps.pool.limitTo(this.deps.processesDuringArt)

    try {
      return await work()
    } finally {
      this.deps.pool.unlimit()
    }
  }

  private async step(args: string[], timeoutMs = this.deps.exportTimeoutMs): Promise<StepOutput> {
    const command = args.includes('--list') ? `${args[0]} --list` : args[0]
    const startedMs = performance.now()
    const run = await this.deps.exporter.run(args, timeoutMs)

    const elapsedSeconds = ((performance.now() - startedMs) / 1000).toFixed(1)
    const ending = run.kind === 'exited' ? `exit ${run.exitCode}` : 'stopped'

    console.log(`export ${command}: ${ending} after ${elapsedSeconds} s`)

    if (run.kind === 'timed-out') {
      return failure('export-failed', `export ${command} was stopped after ${run.timeoutMs} ms`)
    }

    // the export's own answer for a line without animations
    if (run.exitCode === 2) return failure('no-animations', run.stderr.trim().slice(-500))

    if (run.exitCode !== 0) {
      return failure('export-failed', `export ${command} exited with ${run.exitCode}: ${run.stderr.trim().slice(-400)}`)
    }

    return { kind: 'done', stdout: run.stdout }
  }
}

function failure(code: ArtFailureCode, message: string): Failure {
  return { kind: 'failure', code, message }
}
