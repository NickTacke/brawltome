import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@brawltome/replay-format'

const [replayPath, cookie, bhidsArg] = process.argv.slice(2)
if (!replayPath || !cookie) {
  console.error('usage: bun scripts/ingest-replay.ts <replay.replay> <cookie> [bhidsJSON]')
  process.exit(1)
}

const raw = readFileSync(replayPath)
const parsed = parse(new Uint8Array(raw))
const entityBhids =
  bhidsArg !== undefined
    ? (JSON.parse(bhidsArg) as Record<string, number>)
    : Object.fromEntries(parsed.entities.map((e, i) => [String(e.id), 1_000_000 + i]))

const formData = new FormData()
formData.set(
  'payload',
  JSON.stringify({
    parsedReplay: parsed,
    entityBhids,
    formatVersion: parsed.formatVersion,
  }),
)
formData.set('raw', new Blob([raw]), 'upload.replay')

const apiUrl = process.env.API_URL ?? 'http://localhost:3000'
const res = await fetch(`${apiUrl}/api/matches/ingest`, {
  method: 'POST',
  headers: { cookie },
  body: formData,
})

const body = await res.text()
console.log(`HTTP ${res.status}`)
console.log(body)
process.exit(res.ok ? 0 : 1)
