import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProcessPool } from '../src/process-pool'

const fake = ['bun', join(import.meta.dir, 'fake-bhnative.ts')]
const pools: ProcessPool[] = []
const folders: string[] = []

afterEach(async () => {
  for (const pool of pools.splice(0)) pool.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

// a game root with one folder per patch, and a work folder holding replays whose text tells the fake what to do
function setup(patches: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'replay-worker-'))

  folders.push(root)
  for (const patch of patches) mkdirSync(join(root, 'games', patch), { recursive: true })
  mkdirSync(join(root, 'work'))

  const replay = (name: string, content: string) => {
    const path = join(root, 'work', name)

    writeFileSync(path, content)

    return path
  }

  return { gameRoot: join(root, 'games'), replay }
}

// the worker waits for this before it claims again
async function untilReady(pool: ProcessPool): Promise<void> {
  for (let waited = 0; !pool.isReady() && waited < 5000; waited += 20) await Bun.sleep(20)
}

async function startPool(gameRoot: string, newestProcesses = 1, previousProcesses = 1) {
  const pool = await ProcessPool.start({
    command: fake,
    gameRoot,
    newestProcesses,
    previousProcesses,
    build: 'dev-test',
    replayTimeoutMs: 1000,
    restartDelayMs: 100,
  })

  pools.push(pool)

  return pool
}

describe('the bh-native process pool', () => {
  test('waits for the ready line before it starts', async () => {
    const { gameRoot } = setup(['11.00'])
    const started = Date.now()

    process.env.FAKE_READY_DELAY_MS = '300'
    await startPool(gameRoot)
    delete process.env.FAKE_READY_DELAY_MS

    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
  })

  test('answers each replay with its own line, in order', async () => {
    const { gameRoot, replay } = setup(['11.00'])
    const pool = await startPool(gameRoot)

    const [first, second] = await Promise.all([
      pool.play(replay('a.replay', 'slow')),
      pool.play(replay('b.replay', 'ok')),
    ])

    expect(first).toMatchObject({ kind: 'line' })
    expect(JSON.parse(first.kind === 'line' ? first.raw : '{}').replay).toBe('a.replay')
    expect(JSON.parse(second.kind === 'line' ? second.raw : '{}').replay).toBe('b.replay')
  })

  test('a replay of an older patch goes to that patch’s process', async () => {
    const { gameRoot, replay } = setup(['11.00', '10.09'])
    const pool = await startPool(gameRoot)

    const answer = await pool.play(replay('old.replay', 'old'))

    expect(answer.kind).toBe('line')
    expect(JSON.parse(answer.kind === 'line' ? answer.raw : '{}').patch).toBe('10.09')
  })

  test('a replay of a patch no process runs answers patch-not-supported', async () => {
    const { gameRoot, replay } = setup(['11.00'])
    const pool = await startPool(gameRoot)

    const answer = await pool.play(replay('old.replay', 'old'))

    expect(answer).toMatchObject({ kind: 'failure', code: 'patch-not-supported' })
  })

  test('a crashed process fails its replay with worker-error and is started again', async () => {
    const { gameRoot, replay } = setup(['11.00'])
    const pool = await startPool(gameRoot)

    expect(await pool.play(replay('boom.replay', 'crash'))).toMatchObject({ kind: 'failure', code: 'worker-error' })
    await untilReady(pool)
    expect((await pool.play(replay('next.replay', 'ok'))).kind).toBe('line')
  })

  test('reports the build and the patches of its running processes from the start', async () => {
    const { gameRoot } = setup(['11.00', '10.09'])
    const pool = await startPool(gameRoot)

    // before any replay, so a restarted worker keeps its previous patch's files from expiring
    expect(pool.report()).toEqual({ build: 'dev-test', patches: ['11.00', '10.09'] })
  })

  test('a replay that never gets an answer fails with worker-error and its process is replaced', async () => {
    const { gameRoot, replay } = setup(['11.00'])
    const pool = await startPool(gameRoot)

    expect(await pool.play(replay('stuck.replay', 'hang'))).toMatchObject({ kind: 'failure', code: 'worker-error' })
    await untilReady(pool)
    expect((await pool.play(replay('next.replay', 'ok'))).kind).toBe('line')
  })

  test('the timeout counts from when the process starts a replay, not while it waits behind another', async () => {
    const { gameRoot, replay } = setup(['11.00'])
    // one process and a 1 s timeout; the second replay waits 0.7 s behind the first, then takes 0.7 s itself
    const pool = await startPool(gameRoot, 1, 0)

    const answers = await Promise.all([pool.play(replay('a.replay', 'slow')), pool.play(replay('b.replay', 'slow'))])

    expect(answers.map((answer) => answer.kind)).toEqual(['line', 'line'])
  })

  test('while a process can\u2019t start again the pool isn\u2019t ready, and it recovers on its own', async () => {
    const { gameRoot, replay } = setup(['11.00'])
    const pool = await startPool(gameRoot)

    // the folder disappears, so the restart after the crash fails
    renameSync(join(gameRoot, '11.00'), join(gameRoot, 'moved'))
    await pool.play(replay('boom.replay', 'crash'))
    await Bun.sleep(300)

    expect(pool.isReady()).toBe(false)

    renameSync(join(gameRoot, 'moved'), join(gameRoot, '11.00'))
    await Bun.sleep(1500)

    expect(pool.isReady()).toBe(true)
  })
})
