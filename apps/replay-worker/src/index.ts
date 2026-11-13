import { realpathSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { createApiClient } from './api-client'
import { readConfig } from './config'
import { ProcessPool } from './process-pool'
import { runOnce } from './worker'

// runs on the replay vm: claims replays from the api, plays them with bh-native, and sends back what it read

const config = readConfig(process.env)
// /opt/bhnative/current links to the folder named after the build, e.g. dev-58fbc3c
const build = basename(dirname(realpathSync(config.bhnativePath)))

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

async function loop(): Promise<void> {
  while (!isStopping) {
    try {
      const outcome = await runOnce({ api, pool, workDir: config.workDir, renewEveryMs: config.renewEveryMs })

      if (outcome === 'idle') await Bun.sleep(config.pollMs)
    } catch (error) {
      console.error('replay worker:', error)
      await Bun.sleep(config.pollMs * 5)
    }
  }
}

// a replay already playing finishes and is answered; nothing new is claimed
process.on('SIGTERM', () => {
  isStopping = true
})

// one loop per process for the newest patch, so that many replays play at once
await Promise.all(Array.from({ length: config.newestProcesses }, loop))
pool.close()
