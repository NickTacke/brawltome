import { describe, expect, test } from 'bun:test'
import { formatDuration, timelineX } from '@/app/matches/ReplayResultView'

describe('replay result graphs', () => {
  test('formats duration and keeps KO markers inside the graph', () => {
    expect(formatDuration(113_296)).toBe('1:53')
    expect(timelineX(0, 113_296)).toBe(20)
    expect(timelineX(200_000, 113_296)).toBe(980)
  })
})
