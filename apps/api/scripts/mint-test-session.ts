import { db, oauthAccount, user } from '@brawltome/database'
import {
  SESSION_TTL_MS,
  createSessionRepo,
  generateSessionToken,
  hashSessionToken,
} from '@brawltome/identity'
import { and, eq } from 'drizzle-orm'

const TEST_DISCORD_ID = 'test-ingest-user'

async function ensureUser(): Promise<string> {
  const existing = await db.query.oauthAccount.findFirst({
    where: and(
      eq(oauthAccount.provider, 'discord'),
      eq(oauthAccount.providerAccountId, TEST_DISCORD_ID),
    ),
  })
  if (existing) return existing.userId

  const [newUser] = await db.insert(user).values({}).returning()
  await db.insert(oauthAccount).values({
    provider: 'discord',
    providerAccountId: TEST_DISCORD_ID,
    userId: newUser.id,
    username: 'test-ingest',
    avatarHash: null,
    refreshToken: null,
  })
  return newUser.id
}

const userId = await ensureUser()
const sessionRepo = createSessionRepo(db)
const rawToken = generateSessionToken()
const id = hashSessionToken(rawToken)
const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
await sessionRepo.create({ id, userId, expiresAt })

console.log(`userId=${userId}`)
console.log(`cookie=brawltome_session=${rawToken}`)
console.log(`rawToken=${rawToken}`)

process.exit(0)
