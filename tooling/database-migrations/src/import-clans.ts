import { importLegacyClans } from '@brawltome/clan/composition'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const result = await importLegacyClans(connectionString)
console.log(JSON.stringify({ capability: 'clans', ...result }))
if (result.status !== 'complete') process.exitCode = 1
