import type { leaderboardPageInputSchema } from '@brawltome/contracts'
import type { z } from 'zod'
import type { FilterOption } from '../FilterSelect'
import { regionOptions } from '../regions'

type BoardQuery = z.infer<typeof leaderboardPageInputSchema>

export type BoardMode = BoardQuery['mode']
export type BoardRegion = BoardQuery['region']

export const bracketOptions: FilterOption[] = [
  { value: '1v1', label: '1v1' },
  { value: '2v2', label: '2v2' },
  { value: 'solo2v2', label: 'Solo 2v2' },
  { value: '3v3', label: '3v3' },
]

export const defaultMode: BoardMode = '1v1'
export const defaultRegion: BoardRegion = 'all'

// checked against the contract in the tests, the contract's schemas stay out of the browser bundle
function isOption(options: FilterOption[], value: unknown): value is string {
  return options.some((option) => option.value === value)
}

export function parseMode(value: unknown): BoardMode {
  return isOption(bracketOptions, value) ? (value as BoardMode) : defaultMode
}

export function parseRegion(value: unknown): BoardRegion | undefined {
  return isOption(regionOptions, value) ? (value as BoardRegion) : undefined
}
