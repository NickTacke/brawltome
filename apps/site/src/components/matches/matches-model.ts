import type { MyReplayContract } from '@brawltome/contracts'

export type MatchesPage =
  | { kind: 'comingSoon' }
  | { kind: 'signedOut'; signInUrl: string }
  | { kind: 'signedIn'; isVerified: boolean; verifySteamUrl: string; replays: MyReplayContract[] }

const rejectionText: Partial<Record<NonNullable<MyReplayContract['rejection']>, string>> = {
  'not-your-match': 'You’re not in this match',
  'patch-not-supported': 'This replay is from a patch BrawlTome can’t read anymore',
  'not-a-replay': 'This isn’t a Brawlhalla replay',
  'too-large': 'This file is too large to be a replay',
  'too-many-pending': 'Too many replays waiting; try again in a few minutes',
  'daily-limit': 'You’ve uploaded the most replays for today',
}

/** What an upload's row says about it. */
export function replayStatusText(replay: MyReplayContract): string {
  if (replay.status === 'waiting') return 'Waiting'

  if (replay.status === 'parsing') return 'Reading the replay'

  if (replay.status === 'done') return 'Ready'

  return (replay.rejection && rejectionText[replay.rejection]) ?? 'Couldn’t read this replay'
}

/** 187000 → "3:07" */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Whether a row is still moving, so the page keeps checking on it. */
export function isUnfinished(replay: MyReplayContract): boolean {
  return replay.status === 'waiting' || replay.status === 'parsing'
}
