import { importLegacyPlayers } from '@brawltome/player/composition'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const result = await importLegacyPlayers(connectionString)
console.log(JSON.stringify({ capability: 'players', ...result }))
if (result.status !== 'complete') process.exitCode = 1
