import { type ClanWeeklySnapshotPayload, type JobContract, readPayloadObject } from '@brawltome/queue'

function parseClanWeeklySnapshotPayload(value: unknown): ClanWeeklySnapshotPayload {
  const payload = readPayloadObject(value, 'clan weekly snapshot')

  if (Object.keys(payload).length > 0) throw new Error('clan weekly snapshot payload must be empty')

  return {}
}

export const clanWeeklySnapshotContract: JobContract<ClanWeeklySnapshotPayload> = {
  kind: 'clan-weekly-snapshot',
  workClasses: ['maintenance'],
  parsePayload: parseClanWeeklySnapshotPayload,
}
