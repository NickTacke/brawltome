import { createHash } from 'node:crypto'
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
  ResultUnansweredError,
} from './art-client'
import type { Exporter } from './art-export'
import {
  isSetIndexPath,
  isStorePath,
  type JobFiles,
  jobFiles,
  listStore,
  readIndexOrigin,
  readIndexSets,
  readStoreMaps,
  removeJobFiles,
  writeHave,
  writeStoreFile,
} from './art-files'
import type { ProcessPool } from './process-pool'

// beside the parse loop: claims an art job, has the export plan and draw only what the art bucket lacks, sends the
// new files through the api, then the manifest. a warm job draws a patch's base looks and maps instead of a match, and
// a predraw job a patch's pre-drawn sets and their index. a match job of a patch with an index is drawn from its sets

export type ArtRunnerDeps = {
  art: ArtClient
  pool: Pick<ProcessPool, 'report' | 'limitTo' | 'unlimit'>
  exporter: Exporter
  // the game folder of a patch is <gameRoot>/<patch>, as for the parse processes
  gameRoot: string
  workDir: string
  artFormat: number
  // the format of the pre-drawn sets the export draws, null when it draws none: the api then hands out no predraw job
  // and no set index
  setFormat: number | null
  // bh-native processes left running while the export draws
  processesDuringArt: number
  renewEveryMs: number
  // how long a plan or render may take, and how long a warm may
  exportTimeoutMs: number
  warmTimeoutMs: number
  // how long naming a patch's sets may take, and how long drawing them may
  predrawTimeoutMs: number
  // whether predraw checks each set against the look baked in (`predraw draw --check`)
  isPredrawChecked: boolean
  // the waits between tries of a file another attempt is uploading, or whose send got no answer
  uploadRetryDelaysMs: number[]
}

// one claimed job as it runs; leaseLost aborts once a renewal hears the lease is gone
type Attempt = { job: ClaimedArt; files: JobFiles; leaseLost: AbortSignal }

type Failure = { kind: 'failure'; code: ArtFailureCode; message: string }
// waiting: the sets a match is drawn from aren't all in the art bucket yet
type Outcome = { kind: 'result'; result: ArtResult } | { kind: 'waiting'; missingSets: string[] } | Failure
type StepOutput = { kind: 'done'; stdout: string } | Failure

// what the runner reads of the export's plan (ExportPlan in the export's scripts/export-plan.ts); with --sets, the
// sets its manifest will name, which the art bucket must hold before the manifest is sent
type ExportPlan = { patch: string; mapId: number; groups: { path: string }[]; map: { path: string }; sets?: string[] }

export class ArtRunner {
  constructor(private readonly deps: ArtRunnerDeps) {}

  /** Claims one art job, exports its art and answers; 'idle' when the api had nothing to do. */
  async runOnce(): Promise<'idle' | 'done'> {
    const report = { ...this.deps.pool.report(), artFormat: this.deps.artFormat, setFormat: this.deps.setFormat }
    const job = await this.deps.art.claim(report)

    if (!job) return 'idle'

    const artDir = join(this.deps.workDir, 'art')
    const leaseLost = new AbortController()
    const renewal = setInterval(() => void this.renew(job, leaseLost), this.deps.renewEveryMs)

    try {
      await this.attempt({ job, files: jobFiles(artDir, job.jobId), leaseLost: leaseLost.signal })
    } finally {
      clearInterval(renewal)
      removeJobFiles(artDir, job.jobId)
    }

    return 'done'
  }

  private async renew(job: ArtJob, leaseLost: AbortController): Promise<void> {
    try {
      if (!(await this.deps.art.renew(job))) leaseLost.abort()
    } catch (error) {
      console.error(`renew art job ${job.jobId}:`, error)
    }
  }

  private async attempt(attempt: Attempt): Promise<void> {
    const { job } = attempt

    try {
      const outcome = await this.exportArt(attempt)

      throwIfLeaseLost(attempt)

      if (outcome.kind === 'result') await this.deps.art.result(job, outcome.result)
      else if (outcome.kind === 'waiting') await this.waitForSets(job, outcome.missingSets)
      else await this.deps.art.failure(job, outcome.code, outcome.message)
    } catch (error) {
      console.error(`art job ${job.jobId}:`, error)

      // another attempt owns the job now, or the result may have been taken: either way nothing more is sent
      if (error instanceof LeaseLostError || error instanceof ResultUnansweredError) return

      const code = error instanceof ArtRefusedError ? 'export-failed' : 'worker-error'

      await this.deps.art.failure(job, code, String(error).slice(0, 500))
    }
  }

  private async exportArt(attempt: Attempt): Promise<Outcome> {
    const { job, files } = attempt
    const gameFolder = join(this.deps.gameRoot, job.patch)

    // the patch names a folder, so it must look like one (11.00)
    if (!/^\d+(\.\d+)*$/.test(job.patch) || !existsSync(gameFolder)) {
      return failure('export-failed', `the worker has no game folder for patch ${job.patch}`)
    }

    mkdirSync(files.store, { recursive: true })

    if (job.kind === 'warm') return this.exportWarm(attempt, gameFolder)

    if (job.kind === 'predraw') return this.exportPredraw(attempt, gameFolder)

    return this.exportMatch(attempt, gameFolder)
  }

  // with the patch's set index, the plan and render name the players' sets instead of drawing their art, and the
  // manifest is in the sets' format. the render reads only the index, not the sets. an index the export can't draw
  // from is left out, and the match is drawn as without one
  private async exportMatch(attempt: Attempt, gameFolder: string): Promise<Outcome> {
    const { job, files } = attempt

    writeFileSync(files.line, job.line ?? new Uint8Array())

    const isFromSets = await this.canDrawFromSets(attempt, gameFolder)
    const setsArgs = isFromSets ? ['--sets', files.index] : []
    const planned = await this.step(attempt, ['plan', gameFolder, files.line, ...setsArgs])

    if (planned.kind === 'failure') return planned

    const plan = JSON.parse(planned.stdout) as ExportPlan
    const planPaths = [...plan.groups.map((group) => group.path), plan.map.path]
    const setPaths = plan.sets ?? []
    const strayPath = [...planPaths, ...setPaths].find((path) => !isStorePath(path))

    if (strayPath !== undefined) return failure('export-failed', `the plan names ${strayPath}, not a store path`)

    // the api refuses a manifest naming a file it lacks, and drawing the players here would be thrown away once the
    // sets are there; a match without an index has none to wait for
    const missingSets = await this.deps.art.missing(job, setPaths)

    if (missingSets.length > 0) return { kind: 'waiting', missingSets }

    const present = await this.presentOf(job, planPaths)

    // the render reads the art groups and map file it doesn't draw again, to name their sheets; it needs no sheets
    await this.download(job, present, files.store)
    writeHave(files, present)

    const outputArgs = ['--have', files.have, '--manifest', files.manifest]
    const renderArgs = ['render', gameFolder, files.line, files.store, ...outputArgs, ...setsArgs]
    const rendered = await this.whileLimited(() => this.step(attempt, renderArgs))

    if (rendered.kind === 'failure') return rendered

    await this.upload(attempt, present)

    const manifest = JSON.parse(readFileSync(files.manifest, 'utf8')) as Record<string, unknown>
    const maps = [{ patch: plan.patch, mapId: plan.mapId, path: plan.map.path }]

    return { kind: 'result', result: { manifest, maps, artFormat: this.artFormatOf(isFromSets) } }
  }

  // downloads the patch's set index, if the claim named one, and says whether the export can draw the match from it
  private async canDrawFromSets(attempt: Attempt, gameFolder: string): Promise<boolean> {
    const { job, files } = attempt

    if (!job.setIndex) return false

    writeFileSync(files.index, await this.deps.art.readFile(job, job.setIndex))

    const refusal = this.setsRefusal(files.index, gameFolder)

    if (refusal === null) return true

    console.warn(`art job ${job.jobId}: draws the match without ${job.setIndex}: ${refusal}`)

    return false
  }

  // render --sets and plan --sets exit 1 for an index of another set format or one named from another game file, and
  // that would fail the match for good. the match is drawn per look then, as for a patch with no index
  private setsRefusal(indexFile: string, gameFolder: string): string | null {
    const origin = readIndexOrigin(indexFile)

    if (!origin) return 'it is not a set index'

    if (origin.format !== this.deps.setFormat) {
      const format = String(origin.format).slice(0, 20)

      return `its sets are format ${format}, the export draws ${this.deps.setFormat ?? 'none'}`
    }

    const gameFile = join(gameFolder, 'BrawlhallaAir.swf')

    if (!existsSync(gameFile)) return `${gameFolder} has no BrawlhallaAir.swf`

    if (origin.game !== fileDigest(gameFile)) return `it was named from another BrawlhallaAir.swf than ${gameFolder}'s`

    return null
  }

  // a match drawn from sets is in the sets' format, so raising the reported format to it later finds the match done
  private artFormatOf(isFromSets: boolean): number {
    if (isFromSets && this.deps.setFormat !== null) return this.deps.setFormat

    return this.deps.artFormat
  }

  private async waitForSets(job: ArtJob, missingSets: string[]): Promise<void> {
    console.log(`art job ${job.jobId}: waits for ${missingSets.length} sets, such as ${missingSets[0]}`)

    await this.deps.art.wait(job)
  }

  // names the patch's sets, draws those the art bucket lacks and sends them, then the index once every set it names
  // is stored. a draw that failed some sets or ran out of time still sends the sets it finished, so running the job
  // again draws only the rest
  private async exportPredraw(attempt: Attempt, gameFolder: string): Promise<Outcome> {
    const { job, files } = attempt
    const timeoutMs = this.deps.predrawTimeoutMs
    const nameArgs = ['predraw', 'name', gameFolder, '--patch', job.patch, '--index', files.index]
    const named = await this.whileLimited(() => this.step(attempt, nameArgs, timeoutMs))

    if (named.kind === 'failure') return named

    const indexPath = named.stdout.trim()

    if (!isSetIndexPath(indexPath)) {
      return failure('export-failed', `predraw name printed ${indexPath.slice(0, 100)}, not a set index path`)
    }

    const setPaths = readIndexSets(files.index)

    if (!setPaths) return failure('export-failed', `predraw name wrote ${indexPath}, which is not a set index`)

    writeHave(files, await this.presentOf(job, setPaths))

    const checkArgs = this.deps.isPredrawChecked ? ['--check'] : []
    const drawArgs = ['predraw', 'draw', gameFolder, files.store, '--index', files.index, '--have', files.have]
    const drawn = await this.whileLimited(() => this.step(attempt, [...drawArgs, ...checkArgs], timeoutMs))

    await this.upload(attempt, [])

    if (drawn.kind === 'failure') return drawn

    const unstored = await this.deps.art.missing(job, setPaths)

    if (unstored.length > 0) {
      return failure('export-failed', `the art bucket lacks ${unstored.length} sets ${indexPath} names: ${unstored[0]}`)
    }

    writeStoreFile(files.store, indexPath, readFileSync(files.index))
    await this.sendFile(attempt, indexPath)

    const result = { manifest: null, maps: [], artFormat: this.deps.artFormat, setIndex: indexPath }

    return { kind: 'result', result }
  }

  private async exportWarm(attempt: Attempt, gameFolder: string): Promise<Outcome> {
    const { job, files } = attempt
    const warmArgs = ['warm', gameFolder, files.store, '--patch', job.patch]
    const listed = await this.step(attempt, [...warmArgs, '--list'])

    if (listed.kind === 'failure') return listed

    const listedPaths = listed.stdout.split('\n').filter(Boolean)
    const strayPath = listedPaths.find((path) => !isStorePath(path))

    if (strayPath !== undefined) return failure('export-failed', `warm --list names ${strayPath}, not a store path`)

    const present = await this.presentOf(job, listedPaths)

    // the result names every map file of the patch, so those already stored come down to tell their map ids
    const storedMaps = present.filter((path) => path.startsWith('maps/'))

    await this.download(job, storedMaps, files.store)
    writeHave(files, present)

    const warmHaveArgs = [...warmArgs, '--have', files.have]
    const warmed = await this.whileLimited(() => this.step(attempt, warmHaveArgs, this.deps.warmTimeoutMs))

    if (warmed.kind === 'failure') return warmed

    await this.upload(attempt, present)

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

  // sends what the export wrote that the bucket still lacks: a sheet shared with another match may be there already.
  // only a path the export wrote is read, whatever the api answers
  private async upload(attempt: Attempt, downloaded: string[]): Promise<void> {
    const { job, files } = attempt
    const downloadedPaths = new Set(downloaded)
    const written = listStore(files.store).filter((path) => !downloadedPaths.has(path))
    const writtenPaths = new Set(written)
    const missing = await this.deps.art.missing(job, written)

    for (const path of missing.filter((path) => writtenPaths.has(path))) await this.sendFile(attempt, path)
  }

  // another attempt may be uploading the same path, a sheet two matches share, or one request may get no answer. the
  // file is sent again a few times rather than dropping the job's whole export; if it still isn't stored after that
  // the job fails as worker-error, to run again, and no manifest goes out before it
  private async sendFile(attempt: Attempt, path: string): Promise<void> {
    const bytes = readFileSync(join(attempt.files.store, path))
    const delaysMs = this.deps.uploadRetryDelaysMs

    for (let tries = 1; ; tries++) {
      throwIfLeaseLost(attempt)

      const outcome = await this.deps.art.putFile(attempt.job, path, bytes)

      if (outcome === 'stored') return

      const delayMs = delaysMs[tries - 1]

      if (delayMs === undefined) {
        const reason = outcome === 'held' ? 'another attempt still holds it' : 'the api gave no answer'

        throw new Error(`send art file ${path}: ${reason} after ${tries} tries`)
      }

      await Bun.sleep(delayMs)
    }
  }

  // drawing takes memory the game processes would otherwise use, so only a few of them run meanwhile
  private async whileLimited<T>(work: () => Promise<T>): Promise<T> {
    try {
      // inside the try, so processes a limit that failed halfway already stopped start again
      await this.deps.pool.limitTo(this.deps.processesDuringArt)

      return await work()
    } finally {
      this.deps.pool.unlimit()
    }
  }

  private async step(attempt: Attempt, args: string[], timeoutMs = this.deps.exportTimeoutMs): Promise<StepOutput> {
    const command = commandOf(args)
    const startedMs = performance.now()
    const run = await this.deps.exporter.run(args, { timeoutMs, signal: attempt.leaseLost })

    const elapsedSeconds = ((performance.now() - startedMs) / 1000).toFixed(1)
    const ending = run.kind === 'exited' ? `exit ${run.exitCode}` : 'stopped'

    console.log(`export ${command}: ${ending} after ${elapsedSeconds} s`)

    if (run.kind === 'stopped') throw new LeaseLostError(`export ${command} for job ${attempt.job.jobId}: stopped`)

    if (run.kind === 'timed-out') {
      return failure('export-failed', `export ${command} was stopped after ${run.timeoutMs} ms`)
    }

    // the export's own answer for a line without animations
    if (run.exitCode === 2) return failure('no-animations', run.stderr.trim().slice(-500))

    // and for a predraw that couldn't draw some sets, which it names on stdout
    if (run.exitCode === 3) return failure('export-failed', failedSetsMessage(run.stdout))

    if (run.exitCode !== 0) {
      return failure('export-failed', `export ${command} exited with ${run.exitCode}: ${run.stderr.trim().slice(-400)}`)
    }

    for (const warning of warningsIn(run.stderr)) {
      console.warn(`export ${command} for job ${attempt.job.jobId}: ${warning}`)
    }

    return { kind: 'done', stdout: run.stdout }
  }
}

// the sha256 of a file's bytes, as the export names a set index's game by
function fileDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// the step as the log names it: `warm --list`, `predraw draw`, `render`
function commandOf(args: string[]): string {
  if (args[0] === 'predraw') return `predraw ${args[1]}`

  return args.includes('--list') ? `${args[0]} --list` : (args[0] ?? '')
}

// predraw draw prints `failed <path> <reason>` for each set it couldn't draw
function failedSetsMessage(stdout: string): string {
  const failed = stdout.split('\n').filter((line) => line.startsWith('failed '))

  return `predraw draw failed ${failed.length} sets: ${failed.slice(0, 3).join('; ')}`.slice(0, 500)
}

// what a step that ended well still warns of. the export writes its progress to stderr too (a line a legend, a line
// of totals), and its readme says which lines a caller should log: the ones that start with `warning: `
const warningPrefix = 'warning: '

function warningsIn(stderr: string): string[] {
  const lines = stderr.split('\n').map((line) => line.trim())
  const warnings = lines.filter((line) => line.startsWith(warningPrefix))

  return warnings.map((warning) => warning.slice(warningPrefix.length, warningPrefix.length + 500))
}

// another attempt may own the job now, so this one stops before it sends anything more
function throwIfLeaseLost(attempt: Attempt): void {
  if (attempt.leaseLost.aborted) throw new LeaseLostError(`art job ${attempt.job.jobId}: the lease was lost`)
}

function failure(code: ArtFailureCode, message: string): Failure {
  return { kind: 'failure', code, message }
}
