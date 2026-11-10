import type { PinWriteAnswer } from '../account/account-model'
import { isPinned } from '../rail/rail-account'
import type { RailAccountStore } from '../rail/rail-account-store'

type PinWrite = (brawlhallaId: number) => Promise<PinWriteAnswer>
type PinWrites = { pin: PinWrite; unpin: PinWrite }

const failed: PinWriteAnswer = { kind: 'failed' }

/** Pins the player, or unpins them when they are pinned, and brings the rail in line with the answer. */
export async function togglePin(store: RailAccountStore, writes: PinWrites, playerId: number): Promise<PinWriteAnswer> {
  const account = store.current()
  const isPinnedNow = account.kind === 'signedIn' && isPinned(account, playerId)
  const write = isPinnedNow ? writes.unpin : writes.pin
  const answer = await write(playerId).catch(() => failed)

  await store.followPinWrite(answer)

  return answer
}
