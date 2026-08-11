import { importLegacyAccounts } from '@brawltome/accounts/composition'

if (process.env.CONFIRM_V2_WRITERS_QUIESCED !== 'true') {
  throw new Error('Set CONFIRM_V2_WRITERS_QUIESCED=true only after every V2 Accounts writer and scheduler is quiescent')
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const result = await importLegacyAccounts(connectionString, { legacyWritersQuiesced: true })
console.log(JSON.stringify({ capability: 'accounts', ...result }))
if (result.status !== 'complete' || !result.reconciliation.exact) process.exitCode = 1
