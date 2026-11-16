import { realpathSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { createApiClient } from './api-client'
import { createArtClient } from './art-client'
import { createExporter, exportCommand } from './art-export'
import { ArtRunner } from './art-runner'
import { readArtFormat, readConfig } from './config'
import { ProcessPool } from './process-pool'
import { runOnce } from './worker'

// runs on the replay vm: claims replays from the api, plays them with bh-native, and sends back what it read. with
// the art export mounted, one more loop draws each stored match's art

const config = readConfig(process.env)
// /opt/bhnative/current links to the folder named after the build, e.g. dev-58fbc3c
const build = basename(dirname(realpathSync(config.bhnativePath)))
const artFormat = readArtFormat(config.animsPath)

const pool = await ProcessPool.start({
  command: [config.bhnativePath],
  gameRoot: config.gameRoot,
  newestProcesses: config.newestProcesses,
  previousProcesses: config.previousProcesses,
  build,
  replayTimeoutMs: config.replayTimeoutMs,
  restartDelayMs: config.restartDelayMs,
})

const api = createApiClient({ apiUrl: config.apiUrl, token: config.token })
let isStopping = false

console.log(
  `replay worker ready: build ${build}, ${config.newestProcesses} + ${config.previousProcesses} bh-native processes`,
)

console.log(artFormat === null ? `art export off: none at ${config.animsPath}` : `art export on: format ${artFormat}`)

async function loop(): Promise<void> {
  while (!isStopping) {
    try {
      const outcome = await runOnce({
        api,
        pool,
        workDir: config.workDir,
        renewEveryMs: config.renewEveryMs,
        artFormat,
      })

      if (outcome === 'idle') await Bun.sleep(config.pollMs)
    } catch (error) {
      console.error('replay worker:', error)
      await Bun.sleep(config.pollMs * 5)
    }
  }
}

async function artLoop(format: number): Promise<void> {
  const runner = new ArtRunner({
    art: createArtClient({ apiUrl: config.apiUrl, token: config.token }),
    pool,
    exporter: createExporter({ command: exportCommand(config.animsPath), exportTimeoutMs: config.exportTimeoutMs }),
    gameRoot: config.gameRoot,
    workDir: config.workDir,
    artFormat: format,
    processesDuringArt: config.processesDuringArt,
    renewEveryMs: config.renewEveryMs,
  })

  while (!isStopping) {
    try {
      if ((await runner.runOnce()) === 'idle') await Bun.sleep(config.pollMs)
    } catch (error) {
      console.error('art export:', error)
      await Bun.sleep(config.pollMs * 5)
    }
  }
}

// a replay already playing finishes and is answered; nothing new is claimed
process.on('SIGTERM', () => {
  isStopping = true
})

// one loop per process for the newest patch, so that many replays play at once
const parseLoops = Array.from({ length: config.newestProcesses }, loop)
const artLoops = artFormat === null ? [] : [artLoop(artFormat)]

await Promise.all([...parseLoops, ...artLoops])
pool.close()
