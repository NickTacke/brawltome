import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

export function resolveOutputPath(out: string | undefined, end: Date, baseDir: string): string {
  const target = out ?? `analytics-review-${end.toISOString().slice(0, 10)}.md`
  return isAbsolute(target) ? target : resolve(baseDir, target)
}

// Creates missing parent directories so `--out reports/review.md` works from a fresh checkout.
export function writeReport(path: string, report: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, report)
}
