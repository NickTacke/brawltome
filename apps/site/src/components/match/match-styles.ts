// one colour per player slot, checked for colour blindness against the page background; a colour follows its player
// wherever they appear on the page
const slotColours = ['#3987e5', '#d95926', '#199e70', '#c98500']

export function slotColour(slot: number): string {
  return slotColours[(slot - 1) % slotColours.length] ?? '#3987e5'
}

// the game tints a player from white through yellow and orange to dark red as their damage climbs
const damageStops: [number, [number, number, number]][] = [
  [0, [226, 232, 240]],
  [45, [245, 208, 66]],
  [100, [240, 132, 44]],
  [150, [222, 56, 46]],
  [260, [112, 18, 34]],
]

/** The colour a damage reads in: the game's own climb from white to dark red, in a straight line between its stops. */
export function damageColour(damage: number): string {
  const upperIndex = damageStops.findIndex(([at]) => at >= damage)

  if (upperIndex === 0) return `rgb(${damageStops[0]?.[1].join(' ')})`

  if (upperIndex < 0) return `rgb(${damageStops.at(-1)?.[1].join(' ')})`

  const [fromAt, from] = damageStops[upperIndex - 1] as (typeof damageStops)[number]
  const [toAt, to] = damageStops[upperIndex] as (typeof damageStops)[number]
  const progress = (damage - fromAt) / (toAt - fromAt)
  const mixed = from.map((channel, index) => Math.round(channel + ((to[index] ?? channel) - channel) * progress))

  return `rgb(${mixed.join(' ')})`
}
