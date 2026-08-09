import { createPostgresAccounts } from '@brawltome/accounts/composition'

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_TEST_SESSION_MINT !== 'true') {
  console.error('Refusing to mint a test session without ALLOW_TEST_SESSION_MINT=true in non-production.')
  process.exit(1)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required')

const runtime = createPostgresAccounts(connectionString)
try {
  const result = await runtime.accounts.signInWithDiscord({
    providerAccountId: 'test-ingest-user',
    displayName: 'test-ingest',
    avatarHash: null,
  })
  console.log(`userId=${result.account.id}`)
  console.log(`cookie=brawltome_session=${result.sessionToken}`)
  console.log(`rawToken=${result.sessionToken}`)
} finally {
  await runtime.close()
}
