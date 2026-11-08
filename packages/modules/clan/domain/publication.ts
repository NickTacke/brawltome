export type ClanPublicationResult = 'applied' | 'already-applied' | 'fenced' | 'superseded'

/** A success older than the one already stored must not replace it, or a slow refresh would roll the clan back. */
export function isOlderThanLastSuccess(checkedAt: Date, lastSuccessAt: Date | null | undefined): boolean {
  if (!lastSuccessAt) return false

  return lastSuccessAt > checkedAt
}
