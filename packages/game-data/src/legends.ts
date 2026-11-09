import { legends } from './generated/legends'

export { legends }

const legendById = new Map(legends.map((legend) => [legend.heroId, legend]))

export const getLegendById = (id: number) => legendById.get(id)
