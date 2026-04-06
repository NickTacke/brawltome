import { SESSION_TTL_MS, generateSessionToken, hashSessionToken } from '../session'
import type { SessionRepo } from '../session.repo'
import type { UserWithPrimaryAccount } from '../user'
import type { UserRepo } from '../user.repo'

export interface SignInWithDiscordDeps {
  userRepo: UserRepo
  sessionRepo: SessionRepo
}

export interface DiscordProfile {
  discordId: string
  username: string
  avatarHash: string | null
}

export interface SignInResult {
  user: UserWithPrimaryAccount
  rawToken: string
  expiresAt: Date
}

export async function signInWithDiscord(deps: SignInWithDiscordDeps, profile: DiscordProfile): Promise<SignInResult> {
  const user = await deps.userRepo.upsertDiscordUser(profile)

  const rawToken = generateSessionToken()
  const hashed = hashSessionToken(rawToken)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await deps.sessionRepo.create({ id: hashed, userId: user.id, expiresAt })

  return { user, rawToken, expiresAt }
}
