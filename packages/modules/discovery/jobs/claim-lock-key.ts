export function discoveryClaimLockKey(effectOperationId: string): string {
  return `discovery-effect:${effectOperationId}`
}
