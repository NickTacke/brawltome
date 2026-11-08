import {
  type DiscoveryProjectionKind,
  discoveryProjectionKinds,
  type LeaderboardOperationKind,
  leaderboardOperationKinds,
  type OperationLease,
  type StatisticsCollectionKind,
  statisticsCollectionKinds,
} from '../model'

export type OperationKind = OperationLease['kind']

export function isLeaderboardKind(kind: string): kind is LeaderboardOperationKind {
  return (leaderboardOperationKinds as readonly string[]).includes(kind)
}

export function isDiscoveryProjectionKind(kind: string): kind is DiscoveryProjectionKind {
  return (discoveryProjectionKinds as readonly string[]).includes(kind)
}

export function isStatisticsCollectionKind(kind: string): kind is StatisticsCollectionKind {
  return (statisticsCollectionKinds as readonly string[]).includes(kind)
}
