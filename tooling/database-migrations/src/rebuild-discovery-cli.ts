import { rebuildMigratedDiscovery } from './rebuild-discovery'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const result = await rebuildMigratedDiscovery(connectionString)
console.log(JSON.stringify({ capability: 'discovery', ...result }))
if (result.status !== 'passed') process.exitCode = 1
