import { describe, expect, test } from 'bun:test'
import { eventHeading, eventName, isSideModeEvent } from '../../domain/event-names'
import { resultLabels } from '../../domain/result-labels'

const march2026 = Date.UTC(2026, 2, 14) / 1000

describe('isSideModeEvent', () => {
  test.each(['Crew Battle Cup', 'TRIPLES Bash', 'Trio Night', 'Open 3v3', 'Brawlball Night', 'Kung Foot Cup'])(
    'flags %s',
    (name) => {
      expect(isSideModeEvent(name)).toBe(true)
    },
  )

  test('keeps a name that only contains the letters of a side mode', () => {
    expect(isSideModeEvent('Patriot Cup')).toBe(false)
  })
})

describe('eventName', () => {
  test('names a Blue Mammoth event the way players say it', () => {
    const name = eventName('Winter Championship - North America 2025', true, march2026)

    expect(name).toEqual({ title: 'Winter Champs', region: 'NA', year: 2026 })
  })

  test('names the world championship Worlds', () => {
    expect(eventName('Brawlhalla World Championship 2025', true, march2026).title).toBe('Worlds')
  })

  test('keeps the edition number of a community event', () => {
    const name = eventName('FROSTBYTE #9: Brawlhalla NA 1v1 | $250 Prize Pool', false, march2026)

    expect(name.title).toBe('Frostbyte #9')
    expect(name.region).toBe('NA')
  })

  test('never gives a name made only of filler words an empty title', () => {
    const name = eventName('Championship Series Invitational Online', false, march2026)

    expect(name.title).toBe('Championship Series')
  })

  test('keeps a single word over the limit whole, without an ellipsis', () => {
    const name = eventName('Supercalifragilisticexpialidocious Cup', false, march2026)

    expect(name.title).toBe('Supercalifragilisticexpialidocious')
    expect(name.title.endsWith('…')).toBe(false)
  })

  test('does not read a region out of the middle of a word', () => {
    expect(eventName('SEA-food Saturdays', false, march2026).region).toBeNull()
  })
})

describe('eventHeading', () => {
  test('joins title, region and year', () => {
    expect(eventHeading('Autumn Championship - Europe 2026', true, march2026)).toBe('Autumn Champs EU 2026')
  })
})

describe('resultLabels', () => {
  const galaxy = (id: string, mode: string, startTime: number, edition: string) => ({
    id,
    fullName: `Galaxy Cup: ${edition}`,
    isOfficial: false,
    startTime,
    mode,
  })

  test('tells two modes of one event apart by mode', () => {
    const labels = resultLabels([galaxy('a', '1v1', march2026, 'Aurora'), galaxy('b', '2v2', march2026, 'Aurora')])

    expect(labels.get('a')?.meta).toBe('2026 · 1v1')
    expect(labels.get('b')?.meta).toBe('2026 · 2v2')
  })

  test('tells two editions of one series apart by edition', () => {
    const labels = resultLabels([
      galaxy('a', '1v1', march2026, 'Aurora'),
      galaxy('b', '1v1', march2026 + 86_400 * 30, 'Ignite'),
    ])

    expect(labels.get('a')?.title).toBe('Galaxy Cup Aurora')
    expect(labels.get('b')?.title).toBe('Galaxy Cup Ignite')
  })

  test('falls back to the day when mode and edition are the same', () => {
    const labels = resultLabels([
      galaxy('a', '1v1', march2026, 'Aurora'),
      galaxy('b', '1v1', march2026 + 86_400 * 7, 'Aurora'),
    ])

    expect(labels.get('a')?.meta).toBe('Mar 14 2026')
    expect(labels.get('b')?.meta).toBe('Mar 21 2026')
  })
})
