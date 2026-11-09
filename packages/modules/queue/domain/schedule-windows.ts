export type DueWindows = {
  firstWindowNumber: number
  lastWindowNumber: number
  nextWindowNumber: number
  missedWindowCount: number
  latenessMs: number
}

/**
 * The windows a schedule owes at materializedAt. All of them become one occurrence: the schedule runs the first
 * window and counts the rest as missed, so a worker that was down does not replay every window.
 */
export function describeDueWindows(schedule: {
  nextWindowNumber: number
  nextDueAt: Date
  dueWindowCount: number
  materializedAt: Date
}): DueWindows {
  const firstWindowNumber = schedule.nextWindowNumber
  const nextWindowNumber = firstWindowNumber + schedule.dueWindowCount

  return {
    firstWindowNumber,
    lastWindowNumber: nextWindowNumber - 1,
    nextWindowNumber,
    missedWindowCount: schedule.dueWindowCount - 1,
    latenessMs: Math.max(0, schedule.materializedAt.getTime() - schedule.nextDueAt.getTime()),
  }
}

// one active crawl per region: a window arriving mid-crawl waits instead of stacking another
export function scheduledDedupeKey(schedule: { id: string; kind: string }, firstWindowNumber: number): string {
  if (schedule.kind === 'leaderboard-deep-crawl') return `schedule:${schedule.id}:deep-crawl`

  return `schedule:${schedule.id}:${firstWindowNumber}`
}
