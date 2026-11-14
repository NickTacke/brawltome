// where the module's files live in the object store

/** `sha256:<hex>` → `replays/<hex>.replay` */
export function replayKey(digest: string): string {
  return `replays/${digest.replace(/^sha256:/, '')}.replay`
}

/** one timeline per match and bhnative build, so a re-parse never overwrites the timeline still in use */
export function timelineKey(matchId: string, build: string): string {
  return `timelines/${matchId}/${build}.json.gz`
}
