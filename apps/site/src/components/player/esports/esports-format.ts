import type { EsportsProfile } from '../../../server/load-player'

export type EsportsResult = EsportsProfile['results'][number]
export type EsportsSet = EsportsResult['sets'][number]
export type EsportsMode = EsportsResult['mode']
export type SetRecord = NonNullable<EsportsResult['setRecord']>

const medalColours = ['text-gold', 'text-silver', 'text-bronze']
const medalFrames = ['var(--color-gold)', 'var(--color-silver)', 'var(--color-bronze)']

export function ordinal(placement: number): string {
  const lastTwo = placement % 100
  const last = placement % 10

  if (lastTwo >= 11 && lastTwo <= 13) return `${placement}th`

  if (last === 1) return `${placement}st`

  if (last === 2) return `${placement}nd`

  return last === 3 ? `${placement}rd` : `${placement}th`
}

export function placementColour(placement: number): string {
  return medalColours[placement - 1] ?? (placement <= 8 ? 'text-strong' : 'text-soft')
}

export function placementFrame(placement: number): string | null {
  return medalFrames[placement - 1] ?? null
}

export function formatEarnings(earnings: number): string {
  if (earnings >= 1000) return `$${Number((earnings / 1000).toFixed(1))}K`

  return `$${Math.round(earnings)}`
}

export function formatSetRecord(record: SetRecord): string {
  return `${record.wins}-${record.losses}`
}

export function eventDate(startTime: number): string {
  const options = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } as const

  // en-GB writes September as "Sept", the rest of the page uses three letters
  return new Date(startTime * 1000).toLocaleDateString('en-GB', options).replace('Sept', 'Sep')
}
