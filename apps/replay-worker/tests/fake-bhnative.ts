// stands in for `bhnative replay <game folder> --stdin` in tests: the game folder's name is its patch, and each
// replay file's text says what to answer: ok, old (a 10.09 replay), crash, slow
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const gameFolder = process.argv[3] ?? ''
const patch = basename(gameFolder)
const versions: Record<string, number> = { '11.00': 271, '10.09': 270 }
const gameVersion = versions[patch] ?? 0
const readyDelayMs = Number(process.env.FAKE_READY_DELAY_MS ?? 50)

function playedLine(replay: string): string {
  return JSON.stringify({ replay, exit: 0, patch, format: 1, stats: { ReplayVersion: gameVersion } })
}

await Bun.sleep(readyDelayMs)
console.error('the game has started; reading replay paths, one a line')

for await (const chunk of Bun.stdin.stream()) {
  for (const path of new TextDecoder().decode(chunk).split('\n').filter(Boolean)) {
    const replay = basename(path)
    const content = readFileSync(path, 'utf8').trim()

    if (content === 'crash') process.exit(9)

    if (content === 'slow') await Bun.sleep(700)

    if (content === 'old' && gameVersion !== 270) {
      console.log(
        JSON.stringify({
          replay,
          exit: 3,
          error: 'another patch',
          replayVersion: '270',
          gameVersion: String(gameVersion),
        }),
      )

      continue
    }

    console.log(playedLine(replay))
  }
}
