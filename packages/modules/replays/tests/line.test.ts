import { describe, expect, test } from 'bun:test'
import { candidateKey, type PlayedLine, parseReplayLine, UnknownFormatError } from '../line'
import { makeLine } from './fixtures/lines'

const played = (json: string) => parseReplayLine(json) as PlayedLine

describe('reading a bh-native line', () => {
  test('reads the match, its players and their stats', () => {
    const line = played(makeLine())

    expect(line.exit).toBe(0)
    expect(line.patch).toBe('11.00')
    expect(line.match.mapName).toBe('Big Crystal Temple')
    expect(line.match.isRanked).toBe(true)
    expect(line.match.durationMs).toBe(180000)
    expect(line.players.map((player) => player.brawlhallaId)).toEqual([1001, 1002])

    expect(line.players[0]).toMatchObject({
      slot: 1,
      name: 'Alpha',
      legendName: 'IMUGI',
      damageDealt: 322.22,
      dodges: 8,
      jumps: 105,
      timeInAirMs: 122256,
      teamKos: 0,
      weapons: { Axe: { Uses: 12, Hits: 5 }, Unarmed: { Uses: 3, Hits: 1 } },
    })

    expect(line.reliability).toEqual({ isReliable: true, failedChecks: [], unchecked: ['weapon', 'move'] })
  })

  test('lists the failed checks of an unreliable match', () => {
    const line = played(makeLine({ isReliable: false }))

    expect(line.reliability.isReliable).toBe(false)
    expect(line.reliability.failedChecks).toEqual(['damage'])
  })

  test('reads a custom room without a timeline', () => {
    const line = played(makeLine({ custom: true }))

    expect(line.match.isCustom).toBe(true)
  })

  test('reads an error line as just its exit code', () => {
    const line = parseReplayLine(makeLine({ exit: 3 }))

    expect(line.exit).toBe(3)
  })

  test('refuses a format it does not know', () => {
    expect(() => parseReplayLine(makeLine({ format: 2 }))).toThrow(UnknownFormatError)
  })

  test('gives the same match key whoever recorded it and however long it took', () => {
    const one = played(makeLine({ seconds: 10 }))

    const other = played(
      makeLine({
        seconds: 30,
        players: [
          { slot: 1, brawlhallaId: 1002, name: 'Bravo' },
          { slot: 2, brawlhallaId: 1001, name: 'Alpha' },
        ],
      }),
    )

    expect(candidateKey(one)).toBe(candidateKey(other))
    expect(candidateKey(one)).not.toBe(candidateKey(played(makeLine({ firstKoStep: 999 }))))
  })
})
