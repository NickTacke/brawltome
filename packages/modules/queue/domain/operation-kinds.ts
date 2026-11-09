import { type LeaderboardOperationKind, leaderboardOperationKinds } from '../model'

export function isLeaderboardKind(kind: string): kind is LeaderboardOperationKind {
  return (leaderboardOperationKinds as readonly string[]).includes(kind)
}
