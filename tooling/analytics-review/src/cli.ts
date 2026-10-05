import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createGrafanaApi } from './grafana'
import { collectReview } from './queries'
import { buildReport } from './report'

function parseArgs(argv: string[]): { days: number; out?: string } {
  let days = 7
  let out: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') days = Number(argv[++i])
    else if (argv[i] === '--out') out = argv[++i]
  }
  if (!Number.isInteger(days) || days < 1) throw new Error('--days must be a positive integer')
  return { days, out }
}

function readPassword(): string {
  const file = join(homedir(), '.config/brawltome/observability.env')
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    throw new Error(`Could not read ${file}`)
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?GRAFANA_ADMIN_PASSWORD\s*=\s*(.*?)\s*$/)
    if (!match) continue
    return match[1].replace(/^(["'])(.*)\1$/, '$2')
  }
  throw new Error(`GRAFANA_ADMIN_PASSWORD not found in ${file}`)
}

const { days, out } = parseArgs(process.argv.slice(2))
const baseUrl = process.env.GRAFANA_URL ?? 'https://observability.brawltome.app'
const end = new Date()
const api = createGrafanaApi(baseUrl, readPassword())
const report = buildReport(await collectReview(api, days, end), { days, end })
const path = out ?? `analytics-review-${end.toISOString().slice(0, 10)}.md`
writeFileSync(path, report)
console.log(path)
