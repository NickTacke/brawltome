import { createHash } from 'node:crypto'

// where the module's files live in the object store

/** `sha256:<hex>` → `replays/<hex>.replay` */
export function replayKey(digest: string): string {
  return `replays/${digest.replace(/^sha256:/, '')}.replay`
}

/**
 * One timeline per parse attempt, named by its lease: a re-parse never overwrites the timeline still in use, and an
 * attempt that lost its lease only ever deletes its own.
 */
export function timelineKey(matchId: string, build: string, leaseToken: string): string {
  return `timelines/${matchId}/${build}-${leaseToken}.json.gz`
}

/**
 * A match's art manifest in the art bucket, for the build whose line it was exported from. One per export attempt,
 * named by its lease, so an attempt that lost its lease never overwrites the manifest in use.
 */
export function manifestKey(matchId: string, build: string, leaseToken: string): string {
  return `matches/${matchId}/${build}-${leaseToken}/manifest.json`
}

/**
 * A match's insights, worked out from the line of one build, by one version of the figures, with one map layout or
 * none. A new version or a layout that appears later gives a new key, so stale insights are never read again.
 */
export function insightsKey(matchId: string, build: string, version: number, layoutPath: string | null): string {
  const layoutName = layoutPath ? createHash('sha1').update(layoutPath).digest('hex').slice(0, 8) : 'none'

  return `insights/${matchId}/${build}/${version}-${layoutName}.json.gz`
}
