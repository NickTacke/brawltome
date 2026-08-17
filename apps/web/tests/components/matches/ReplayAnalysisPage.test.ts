import { describe, expect, test } from 'bun:test'
import { ReplayResultView, formatDuration, timelineX } from '@/app/matches/ReplayResultView'
import { MATCH_SUMMARY_EXTENSION_URI, type ReplayJobDetailContract } from '@brawltome/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const replayJob = {
  id: '1b2f7508-8e9c-4b1a-950f-d60fabe27176',
  status: 'completed',
  fileName: 'match.replay',
  createdAt: '2026-08-16T10:00:00.000Z',
  updatedAt: '2026-08-16T10:00:00.000Z',
  failure: null,
  result: {
    core: {
      replay: {
        durationMs: 60_000,
        format: 268,
        koTimeline: [{ timestampMs: 30_000, victimSlot: 1, scoringSlot: null }],
        mapId: 0,
        matchSettings: { lives: 3, teamMode: false },
        online: true,
        outcome: { winningTeamId: 0 },
        players: [
          { slot: 0, name: 'Winner', playerId: null, score: 3, teamId: 0, loadout: { legendId: 0 } },
          { slot: 1, name: 'Victim', playerId: null, score: 1, teamId: 1, loadout: { legendId: 0 } },
        ],
        playlistId: 1,
      },
      native: {
        players: [
          {
            slot: 0,
            airTimeMs: 696,
            groundTimeMs: 303,
            wallTimeMs: 1,
            damageDealt: 10,
            damageTaken: 10,
            kos: 1,
            deaths: 0,
          },
          {
            slot: 1,
            airTimeMs: 696,
            groundTimeMs: 303,
            wallTimeMs: 1,
            damageDealt: 10,
            damageTaken: 10,
            kos: 0,
            deaths: 1,
          },
        ],
      },
    },
    extensions: {
      [MATCH_SUMMARY_EXTENSION_URI]: {
        data: {
          equipment: [],
          players: [0, 1].map((slot) => ({
            slot,
            airTimeShare: 0.696,
            groundTimeShare: 0.303,
            wallTimeShare: 0.001,
            damageDealtPerMinute: 10,
          })),
        },
      },
    },
  },
} as unknown as ReplayJobDetailContract

describe('replay result graphs', () => {
  test('formats duration and keeps KO markers inside the graph', () => {
    expect(formatDuration(113_296)).toBe('1:53')
    expect(timelineX(0, 113_296)).toBe(20)
    expect(timelineX(200_000, 113_296)).toBe(980)
  })

  test('renders truthful positioning and unattributed knockout copy', () => {
    const html = renderToStaticMarkup(createElement(ReplayResultView, { job: replayJob }))

    expect(html).toContain('Air 69.6% · Ground 30.3% · Wall 0.1%')
    expect(html).not.toContain('dodges/min')
    expect(html).toContain('Unknown scorer')
    expect(html).not.toContain('Environment')
  })
})
