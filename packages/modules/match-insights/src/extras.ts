import type { InsightExtras, PlayerExtras } from '@brawltome/contracts'
import { countPresses } from './inputs'
import type { LinePlayer } from './line'
import { type MatchRecord, stateOf, statsOf, toMs } from './record'
import { weaponLabel } from './weapon-names'

// what the game's counters leave out: movement counts, inputs and the loadout each player brought

const stanceNames: Record<string, string> = {
  Base: 'Base',
  Str: 'Strength',
  Dex: 'Dexterity',
  Def: 'Defense',
  Spd: 'Speed',
  SupStr: 'Super Strength',
  SupDex: 'Super Dexterity',
  SupDef: 'Super Defense',
  SupSpd: 'Super Speed',
  Challenge: 'Challenge',
}

function countOwnEvents(record: MatchRecord, slot: number, type: string): number {
  return record.events.filter((event) => event.type === type && 'player' in event && event.player === slot).length
}

function countSpotDodges(record: MatchRecord, slot: number): number {
  return record.events.filter((event) => event.type === 'dodge' && event.player === slot && !event.direction).length
}

function loadoutOf(record: MatchRecord, slot: number) {
  const loadout = statsOf(record, slot).Loadout
  const stanceKey = loadout.Stance ?? ''
  const skins = [loadout.WeaponSkin1, loadout.WeaponSkin2].filter((skin) => skin !== undefined)

  return {
    stanceKey,
    stance: stanceNames[stanceKey] ?? stanceKey,
    skin: loadout.SkinName ?? '',
    colour: loadout.ColorSchemeName ?? '',
    weaponSkins: skins.map((skin) => ({ weapon: weaponLabel(skin.Weapon), name: skin.WeaponSkinName })),
    sidekick: loadout.SidekickName ?? '',
    koEffect: loadout.KOEffectName ?? '',
  }
}

function damageTakenByWeapon(record: MatchRecord, slot: number): Record<string, number> {
  const weapons = statsOf(record, slot).weapons.filter((weapon) => weapon.damageTaken !== null)

  return Object.fromEntries(weapons.map((weapon) => [weapon.weapon, weapon.damageTaken as number]))
}

function readPlayerExtras(record: MatchRecord, player: LinePlayer): PlayerExtras {
  const { slot } = player
  const stats = statsOf(record, slot)
  const state = stateOf(record, slot)
  const minutes = record.durationMs / 60_000

  return {
    slot,
    team: player.team,
    weaponSeries: state.weapon.map(([step, weapon]): [number, string] => [toMs(record, step), weapon]),
    dashes: stats.Dashes,
    jumps: stats.TotalJumps,
    dashJumps: stats.DashJumps,
    airJumps: stats.AirJumps,
    clashes: stats.Clashes,
    suicides: stats.Suicides,
    pickups: countOwnEvents(record, slot, 'pickup'),
    throws: countOwnEvents(record, slot, 'throw'),
    inputsPerMinute: minutes > 0 ? countPresses(state.input) / minutes : 0,
    spotDodges: countSpotDodges(record, slot),
    ...loadoutOf(record, slot),
    damageTakenByWeapon: damageTakenByWeapon(record, slot),
  }
}

export function readExtras(record: MatchRecord): InsightExtras {
  const { rules } = record.line.match

  return {
    queue: rules.queue ?? null,
    isRanked: rules.isRanked,
    stocks: rules.stocks ?? null,
    isReliable: record.line.reliability.isReliable,
    players: record.players.map((player) => readPlayerExtras(record, player)),
  }
}
