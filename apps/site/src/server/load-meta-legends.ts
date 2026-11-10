import { type MetaLegendsContract, metaLegendsSchema } from '@brawltome/contracts'
import { readApi } from './api'
import { optionalRead, readOptional } from './optional-read'

export type MetaLegend = NonNullable<MetaLegendsContract>['legends'][number]

const shownLegendCount = 5

async function readMetaLegends(): Promise<MetaLegend[]> {
  const meta = await readApi('/legends/meta', metaLegendsSchema, 'load meta legends', optionalRead)

  return meta?.legends.slice(0, shownLegendCount) ?? []
}

/** The legends high rated players play this season, or none when they couldn't be read, so the section hides. */
export function loadMetaLegends(): Promise<MetaLegend[]> {
  return readOptional(readMetaLegends, [])
}
