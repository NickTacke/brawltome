import type { MatchSummaryContract, MyMatchesContract, MyReplayContract } from '@brawltome/contracts'

export type MatchList = { matches: MatchSummaryContract[]; nextCursor: string | null }

export type MatchesPage =
  | { kind: 'comingSoon' }
  | { kind: 'signedOut'; signInUrl: string; recent: MatchList; loadedAt: string }
  | {
      kind: 'signedIn'
      canUpload: boolean
      verifySteamUrl: string
      replays: MyReplayContract[]
      mine: MyMatchesContract
      recent: MatchList
      loadedAt: string
    }

// a failed upload stays in view for a day, long enough to be seen and not so long it clutters the page
const failedUploadShownMs = 24 * 60 * 60 * 1000

/** The uploads worth showing: those still being read, and those that failed in the last day. */
export function uploadsInView(replays: MyReplayContract[], now: Date): MyReplayContract[] {
  return replays.filter((replay) => {
    if (isUnfinished(replay)) return true

    const isRecent = now.getTime() - new Date(replay.createdAt).getTime() < failedUploadShownMs

    return replay.status === 'rejected' && isRecent
  })
}

// short enough to sit beside a file name in the side column
const rejectionText: Partial<Record<NonNullable<MyReplayContract['rejection']>, string>> = {
  'not-your-match': 'Not your match',
  'patch-not-supported': 'Patch too old',
  'not-a-replay': 'Not a replay',
  'too-large': 'Too large',
  'too-many-pending': 'Too many waiting',
  'daily-limit': 'Daily limit reached',
  'never-ended': 'Not a full match',
}

/** What an upload's row says about it. */
export function replayStatusText(replay: MyReplayContract): string {
  if (replay.status === 'waiting') return 'Waiting'

  if (replay.status === 'parsing') return 'Reading…'

  if (replay.status === 'done') return 'Ready'

  return (replay.rejection && rejectionText[replay.rejection]) ?? 'Couldn’t read it'
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
