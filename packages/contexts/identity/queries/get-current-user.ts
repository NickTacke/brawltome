import { SESSION_EXTEND_THRESHOLD_MS, SESSION_TTL_MS, hashSessionToken } from '../session'
import type { Session } from '../session'
import type { SessionRepo } from '../session.repo'
import type { UserWithPrimaryAccount } from '../user'
import type { UserRepo } from '../user.repo'

export interface GetCurrentUserDeps {
  userRepo: UserRepo
  sessionRepo: SessionRepo
}

export interface CurrentUserResult {
  user: UserWithPrimaryAccount
  session: Session
  extended: boolean
}

export async function getCurrentUser(
  deps: GetCurrentUserDeps,
  rawToken: string | null,
): Promise<CurrentUserResult | null> {
  if (!rawToken) return null

  const id = hashSessionToken(rawToken)
  const session = await deps.sessionRepo.findById(id)
  if (!session) return null

  const now = Date.now()
  if (session.expiresAt.getTime() <= now) return null

  const user = await deps.userRepo.findById(session.userId)
  if (!user) return null

  let extended = false
  if (session.expiresAt.getTime() - now < SESSION_EXTEND_THRESHOLD_MS) {
    const newExpiry = new Date(now + SESSION_TTL_MS)
    await deps.sessionRepo.extend(id, newExpiry)
    session.expiresAt = newExpiry
    extended = true
  }

  return { user, session, extended }
}
