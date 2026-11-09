export type Migration = {
  identity: string
  predecessor: string | null
  checksum: string
  sql: string
  // identities of other owners' migrations that must run first
  requires?: readonly string[]
  // like requires, for owners a database can be built without: only the ones in the list affect the order
  requiresIfPresent?: readonly string[]
}
