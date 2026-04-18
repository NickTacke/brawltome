#!/usr/bin/env bun
// End-to-end regeneration. Runs the SWZ extractor, then the game-data ingester.
// Usage: bun run regen 10.05
//   or:  GAME_DATA_PATCH_VERSION=10.05 bun run regen

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const EXTRACTOR = join(REPO_ROOT, 'research', 'swz-extract', 'extract.ts')
const INGESTER = join(import.meta.dir, 'ingest.ts')
const patch = process.env.GAME_DATA_PATCH_VERSION ?? process.argv[2] ?? 'unknown'

if (!existsSync(EXTRACTOR)) {
  console.error(`extractor not found at ${EXTRACTOR}`)
  console.error('Restore research/swz-extract/ (gitignored; see research/README-internal if any).')
  process.exit(1)
}

console.log('[regen] SWZ extract from local Brawlhalla install...')
await $`cd ${join(REPO_ROOT, 'research', 'swz-extract')} && bun run extract.ts`

console.log(`[regen] ingest SWZ -> TS (patch=${patch})...`)
await $`bun ${INGESTER} ${patch}`

console.log('[regen] done.')
