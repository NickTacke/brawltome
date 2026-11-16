import type { Moment } from '@brawltome/contracts'
import { LegendMark } from '../LegendMark'
import { formatDamage } from '../match-format'
import type { LanePlayer } from './lane-players'
import { changesWeapon } from './moment-text'
import { moveCode } from './move-notation'
import { WeaponMark } from './WeaponMark'

function Player({ lane, isSoft }: { lane: LanePlayer | undefined; isSoft: boolean }) {
  if (!lane) return null

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <LegendMark player={lane.player} slot={lane.player.slot} isDecorative />
      <span className={`truncate text-sm ${isSoft ? 'text-text' : 'font-bold text-strong'}`}>{lane.player.name}</span>
    </span>
  )
}

/**
 * Who got hit and by whom, each with their legend in their own colour: the same colours as the rings on the stage.
 * Two long names take a line each instead of both being cut short.
 */
export function WhoHitWhom({ moment, lanes }: { moment: Moment; lanes: LanePlayer[] }) {
  const laneOf = (slot: number | null) => lanes.find((lane) => lane.player.slot === slot)

  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Player lane={laneOf(moment.victim)} isSoft={false} />
      {moment.attacker === null ? null : (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs text-soft">{moment.hits.length > 0 ? 'hit by' : 'sent out by'}</span>
          <Player lane={laneOf(moment.attacker)} isSoft />
        </span>
      )}
    </p>
  )
}

/** The hits in order as one string in the community's own short names, with the weapon where it changes. */
export function HitString({ moment }: { moment: Moment }) {
  // a KO with no punish behind it has no hits to list
  if (moment.hits.length === 0) return null

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[0.8125rem]">
      {moment.hits.map((hit, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the hits of a moment never change order
          key={index}
          className="flex items-center gap-1.5 whitespace-nowrap"
        >
          {index > 0 ? <span className="text-soft">→</span> : null}
          {changesWeapon(moment.hits, index) ? <WeaponMark weapon={hit.weapon} /> : null}
          <span className="text-text">{moveCode(hit.name)}</span>
          <span className="font-bold text-strong">{formatDamage(hit.damage)}</span>
        </span>
      ))}
    </p>
  )
}

/** What the moment cost; a KO says so in its class, so the cost is the damage alone. */
export function MomentCost({ moment }: { moment: Moment }) {
  if (moment.damage <= 0) return null

  return (
    <span className="shrink-0 text-lg leading-6 font-bold text-strong tabular-nums">{formatDamage(moment.damage)}</span>
  )
}
