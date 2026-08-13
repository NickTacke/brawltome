import { importLegacyPlayerProfiles, importLegacyPlayers } from '@brawltome/player/composition'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const scope = process.env.PLAYER_IMPORT_SCOPE ?? 'full'
if (scope !== 'full' && scope !== 'profiles') throw new Error('PLAYER_IMPORT_SCOPE must be full or profiles')
const options = { legacyWritersQuiesced: process.env.LEGACY_WRITERS_QUIESCED === 'true' ? (true as const) : undefined }
const result =
  scope === 'profiles'
    ? await importLegacyPlayerProfiles(connectionString, options)
    : await importLegacyPlayers(connectionString, options)
console.log(JSON.stringify({ capability: 'players', ...result }))
if (result.status !== 'complete') process.exitCode = 1
