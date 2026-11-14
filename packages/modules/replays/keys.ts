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
