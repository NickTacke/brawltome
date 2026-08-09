const sql = 'CREATE SCHEMA IF NOT EXISTS players;\n'

export const initializePlayersSchema = {
  identity: 'players/0001',
  predecessor: null,
  checksum: '9fff6573583618708c9c931a59389543124d9848ac747012682ea278eda23bc4',
  sql,
} as const
