import { isAbsolute, resolve } from 'node:path'

export function resolveOutputPath(out: string | undefined, end: Date, baseDir: string): string {
  const target = out ?? `analytics-review-${end.toISOString().slice(0, 10)}.md`
  return isAbsolute(target) ? target : resolve(baseDir, target)
}
