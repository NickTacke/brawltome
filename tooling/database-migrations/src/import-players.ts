import {
  importLegacyCareerSnapshots,
  importLegacyPlayerProfiles,
  importLegacyPlayers,
  importLegacyReferenceHistory,
} from '@brawltome/player/composition'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const scope = process.env.PLAYER_IMPORT_SCOPE ?? 'full'
if (scope !== 'full' && scope !== 'profiles' && scope !== 'career' && scope !== 'reference-history') {
  throw new Error('PLAYER_IMPORT_SCOPE must be full, profiles, career, or reference-history')
}
const options = {
  batchSize: process.env.PLAYER_IMPORT_BATCH_SIZE ? Number(process.env.PLAYER_IMPORT_BATCH_SIZE) : undefined,
  maxBatches: process.env.PLAYER_IMPORT_MAX_BATCHES ? Number(process.env.PLAYER_IMPORT_MAX_BATCHES) : undefined,
  legacyWritersQuiesced: process.env.LEGACY_WRITERS_QUIESCED === 'true' ? (true as const) : undefined,
}
const importer = {
  full: importLegacyPlayers,
  profiles: importLegacyPlayerProfiles,
  career: importLegacyCareerSnapshots,
  'reference-history': importLegacyReferenceHistory,
}[scope]
const result = await importer(connectionString, options)
console.log(JSON.stringify({ capability: 'players', ...result }))
if (result.status !== 'complete') process.exitCode = 1
