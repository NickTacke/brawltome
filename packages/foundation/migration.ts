export type Migration = {
  identity: string
  predecessor: string | null
  checksum: string
  sql: string
  // identities of other owners' migrations that must run first
  requires?: readonly string[]
}
