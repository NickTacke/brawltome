import { legends } from './generated/legends'

const legendById = new Map(legends.map((legend) => [legend.heroId, legend]))

export { legends }
export const getLegendById = (id: number) => legendById.get(id)
