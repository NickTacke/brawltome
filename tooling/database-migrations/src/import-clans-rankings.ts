import { importLegacyClans } from '@brawltome/clan/composition'
import { importLegacyRankings } from '@brawltome/ranking/composition'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const clans = await importLegacyClans(connectionString)
console.log(JSON.stringify({ capability: 'clans', ...clans }))
if (clans.status !== 'complete') {
  process.exitCode = 1
} else {
  const rankings = await importLegacyRankings(connectionString)
  console.log(JSON.stringify({ capability: 'rankings', ...rankings }))
  if (rankings.status !== 'complete') process.exitCode = 1
}
