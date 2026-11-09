/** What the page learns from asking for a refresh. Plain fields only, it travels from a server function to the browser. */
export type RefreshAnswer =
  | { kind: 'refreshing'; pollAfterSeconds: number }
  | { kind: 'fresh' }
  | { kind: 'verify'; siteKey: string | null }
  | { kind: 'refused'; retryAfterSeconds: number }
  | { kind: 'unavailable'; retryAfterSeconds: number }
