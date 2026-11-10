import { Pin } from 'lucide-react'
import { useState } from 'react'
import { pinAccountPlayer, unpinAccountPlayer } from '../../server/account'
import { AccountLink } from '../rail/AccountLink'
import { isAtPinLimit, isPinned, isVerifiedPlayer, type RailAccount } from '../rail/rail-account'
import { railAccount, useRailAccount } from '../rail/use-rail-account'
import { togglePin } from './pin-toggle'

// the same size and colour as the aliases button beside it
const buttonStyle =
  'inline-flex min-h-6 items-center gap-1.5 text-soft transition-colors hover:text-strong focus-visible:text-strong disabled:opacity-60 disabled:hover:text-soft'

const writes = {
  pin: (brawlhallaId: number) => pinAccountPlayer({ data: brawlhallaId }),
  unpin: (brawlhallaId: number) => unpinAccountPlayer({ data: brawlhallaId }),
}

type PinButtonViewProps = {
  account: RailAccount
  playerId: number
  isBusy: boolean
  hasFailed: boolean
  onToggle: () => void
}

function buttonText(isPinnedNow: boolean, isFull: boolean, hasFailed: boolean): string {
  if (hasFailed) return "Couldn't save, try again"

  if (isPinnedNow) return 'Pinned'

  return isFull ? 'Pin limit reached' : 'Pin'
}

export function PinButtonView({ account, playerId, isBusy, hasFailed, onToggle }: PinButtonViewProps) {
  if (isVerifiedPlayer(account, playerId)) return null

  if (account.kind === 'signedOut') {
    return (
      <AccountLink className={buttonStyle}>
        Pin
        <Pin className="size-4" aria-hidden="true" />
      </AccountLink>
    )
  }

  const isPinnedNow = isPinned(account, playerId)
  const isFull = !isPinnedNow && isAtPinLimit(account)

  return (
    <button
      type="button"
      aria-pressed={isPinnedNow}
      aria-busy={isBusy}
      disabled={isBusy || isFull}
      onClick={onToggle}
      className={buttonStyle}
    >
      {buttonText(isPinnedNow, isFull, hasFailed)}
      <Pin className="size-4" fill={isPinnedNow ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  )
}

/** Pins the player to the visitor's account, and the rail shows the pin at once. */
export function PinButton({ playerId }: { playerId: number }) {
  const account = useRailAccount()
  const [isBusy, setIsBusy] = useState(false)
  const [hasFailed, setHasFailed] = useState(false)

  async function toggle() {
    setIsBusy(true)
    setHasFailed(false)

    const answer = await togglePin(railAccount, writes, playerId)

    setIsBusy(false)
    setHasFailed(answer.kind === 'failed')
  }

  const viewProps = { account, playerId, isBusy, hasFailed, onToggle: () => void toggle() }

  return <PinButtonView {...viewProps} />
}
