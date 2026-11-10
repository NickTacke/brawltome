import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { reorderAccountPins, unpinAccountPlayer } from '../../server/account'
import type { PinnedPlayerRow, PinWriteAnswer } from './account-model'
import { movePin, orderRows } from './pin-order'

type PinsFromPage = { pins: PinnedPlayerRow[]; pinOrder: number[] }

const failed: PinWriteAnswer = { kind: 'failed' }

/** The pins on screen, changed one write at a time and only once the api has taken the change. */
export function usePins(page: PinsFromPage, verifiedId: number | null) {
  const router = useRouter()
  const [pins, setPins] = useState(page.pins)
  const [pinOrder, setPinOrder] = useState(page.pinOrder)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [hasFailed, setHasFailed] = useState(false)

  // a reload of the page, after a sign-in elsewhere or a finished verification, brings new pins
  useEffect(() => {
    setPins(page.pins)
    setPinOrder(page.pinOrder)
  }, [page.pins, page.pinOrder])

  async function write(brawlhallaId: number, send: () => Promise<PinWriteAnswer>) {
    setBusyId(brawlhallaId)
    setHasFailed(false)

    const answer = await send().catch(() => failed)

    setBusyId(null)

    if (answer.kind === 'signedOut') {
      await router.invalidate()

      return
    }

    if (answer.kind === 'failed') {
      setHasFailed(true)

      return
    }

    setPinOrder(answer.pinOrder)
    setPins((current) => orderRows(current, answer.pinOrder))
  }

  function move(brawlhallaId: number, step: -1 | 1) {
    const newOrder = movePin(pinOrder, verifiedId, brawlhallaId, step)

    if (newOrder) void write(brawlhallaId, () => reorderAccountPins({ data: newOrder }))
  }

  function unpin(brawlhallaId: number) {
    void write(brawlhallaId, () => unpinAccountPlayer({ data: brawlhallaId }))
  }

  return { pins, isBusy: busyId !== null, hasFailed, move, unpin }
}
