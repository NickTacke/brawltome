import { type MostPlayedLegendsContract, mostPlayedLegendsSchema } from '@brawltome/contracts'
import { readApi } from './api'
import { optionalRead, readOptional } from './optional-read'

export type MostPlayedLegend = NonNullable<MostPlayedLegendsContract>['legends'][number]

const shownLegendCount = 9

async function readMostPlayedLegends(): Promise<MostPlayedLegend[]> {
  const counts = await readApi(
    '/legends/most-played',
    mostPlayedLegendsSchema,
    'load most played legends',
    optionalRead,
  )

  return counts?.legends.slice(0, shownLegendCount) ?? []
}

/** This season's most played legends, or none when they couldn't be read, so the section hides and Home still shows. */
export function loadMostPlayedLegends(): Promise<MostPlayedLegend[]> {
  return readOptional(readMostPlayedLegends, [])
}
