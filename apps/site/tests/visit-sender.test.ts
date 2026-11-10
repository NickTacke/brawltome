import { describe, expect, test } from 'bun:test'
import type { SiteVisitInputContract } from '@brawltome/contracts'
import { createVisitSender } from '../src/components/visits/visit-sender'

const visitId = 'd'.repeat(32)

function senderRecording(countPageView: (visit: SiteVisitInputContract) => Promise<unknown>) {
  return createVisitSender({ visitId, viewportWidth: () => 390, referrerDomain: 'reddit.com', countPageView })
}

describe('visit sender', () => {
  test('names the referrer on the first view of the tab only', () => {
    const sent: SiteVisitInputContract[] = []
    const send = senderRecording(async (visit) => sent.push(visit))

    send('/player/7', true)
    send('/queue', false)

    expect(sent).toEqual([
      { visitId, path: '/player/7', viewportWidth: 390, referrerDomain: 'reddit.com' },
      { visitId, path: '/queue', viewportWidth: 390 },
    ])
  })

  test('a failed send never reaches the page', async () => {
    const rejects = senderRecording(() => Promise.reject(new Error('network down')))

    const throws = senderRecording(() => {
      throw new Error('server function missing')
    })

    expect(() => rejects('/', true)).not.toThrow()
    expect(() => throws('/', true)).not.toThrow()

    // a rejection left unhandled would surface after the call returns
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
