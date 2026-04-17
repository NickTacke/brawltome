export type { User, OAuthAccount, UserWithPrimaryAccount } from './user'
export type { Session } from './session'
export {
  SESSION_TTL_MS,
  SESSION_EXTEND_THRESHOLD_MS,
  generateSessionToken,
  hashSessionToken,
} from './session'
export { createUserRepo, type UserRepo } from './user.repo'
export { createSessionRepo, type SessionRepo } from './session.repo'
export type { PlayerLink, PlayerLinkStatus, PlayerLinkRepo } from './playerLink.repo'
export { createPlayerLinkRepo } from './playerLink.repo'
export { signInWithDiscord } from './commands/sign-in-with-discord'
export type {
  SignInWithDiscordDeps,
  DiscordProfile,
  SignInResult,
} from './commands/sign-in-with-discord'
export { signOut } from './commands/sign-out'
export type { SignOutDeps } from './commands/sign-out'
export { linkPlayer, PlayerAlreadyLinkedError } from './commands/link-player'
export type { LinkPlayerDeps } from './commands/link-player'
export { resolveSteamLink } from './commands/resolve-steam-link'
export type { ResolveSteamLinkDeps } from './commands/resolve-steam-link'
export { unlinkPlayer } from './commands/unlink-player'
export type { UnlinkPlayerDeps } from './commands/unlink-player'
export { getCurrentUser } from './queries/get-current-user'
export type { GetCurrentUserDeps, CurrentUserResult } from './queries/get-current-user'
