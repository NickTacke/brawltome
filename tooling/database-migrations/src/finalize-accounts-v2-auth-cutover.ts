import { createPostgresAccounts } from '@brawltome/accounts/composition'

if (process.env.CONFIRM_V2_AUTH_WRITERS_QUIESCED !== 'true') {
  throw new Error('Set CONFIRM_V2_AUTH_WRITERS_QUIESCED=true only after every V2 auth writer is quiescent')
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const runtime = createPostgresAccounts(connectionString)
try {
  const result = await runtime.finalizeV2AuthCutover({ legacyWritersQuiesced: true })
  console.log(`Finalized ${result.finalizedSessions} imported Accounts session(s).`)
} finally {
  await runtime.close()
}
