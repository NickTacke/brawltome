import { writeFileSync } from 'node:fs'
import { resolveGrafanaConfig } from './config'
import { createGrafanaApi } from './grafana'
import { resolveOutputPath } from './output-path'
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

const { days, out } = parseArgs(process.argv.slice(2))
const end = new Date()
let config: ReturnType<typeof resolveGrafanaConfig>
try {
  config = resolveGrafanaConfig(process.env)
} catch (error) {
  console.error((error as Error).message)
  process.exit(1)
}
const api = createGrafanaApi(config.baseUrl, config.password)
const report = buildReport(await collectReview(api, days, end), { days, end })
const path = resolveOutputPath(out, end, process.env.INIT_CWD ?? process.cwd())
writeFileSync(path, report)
console.log(path)
