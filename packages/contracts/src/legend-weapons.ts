// the narrow entries, the package root also loads megabytes of frame data this ships to browsers
import { legends } from '@brawltome/game-data/legends'
import { normalizeWeaponName } from '@brawltome/game-data/reference-data'

export type LegendWeapons = { weaponOne: string; weaponTwo: string }

const playableLegends = legends.filter((legend) => legend.weaponOne !== '')

/** Each legend's two weapons, for clients that can't depend on the game data package themselves. */
export const legendWeapons: ReadonlyMap<number, LegendWeapons> = new Map(
  playableLegends.map((legend) => [
    legend.heroId,
    { weaponOne: normalizeWeaponName(legend.weaponOne), weaponTwo: normalizeWeaponName(legend.weaponTwo) },
  ]),
)
