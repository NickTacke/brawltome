import { hashSessionToken } from '../session'
import type { SessionRepo } from '../session.repo'

export interface SignOutDeps {
  sessionRepo: SessionRepo
}

export async function signOut(deps: SignOutDeps, rawToken: string): Promise<void> {
  await deps.sessionRepo.deleteById(hashSessionToken(rawToken))
}
