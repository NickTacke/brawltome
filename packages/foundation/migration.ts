export type Migration = {
  identity: string
  predecessor: string | null
  checksum: string
  sql: string
}
