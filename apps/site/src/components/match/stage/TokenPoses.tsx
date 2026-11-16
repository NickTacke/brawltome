import type { SummaryPlayer } from '@brawltome/contracts'
import { legendAvatarUrl } from '../../guild/legend-avatar-url'
import { formatDamage } from '../match-format'
import { damageColour, slotColour } from '../match-styles'
import { weaponIconName } from '../weapon-icon'
import type { Pose } from './pose'

// who stands on the stage: what a token shows of a player besides their pose
export type StagePlayer = Pick<SummaryPlayer, 'slot' | 'name' | 'legendKey'>

export type TokenPosesProps = { poses: Pose[]; players: StagePlayer[]; selectedSlot: number }

// which way the player faces, as a small wedge on that side of the portrait
function FacingWedge({ facingRight, colour }: { facingRight: boolean; colour: string }) {
  const side = facingRight ? 'left-full border-l-[0.375rem]' : 'right-full border-r-[0.375rem]'

  return (
    <span
      className={`absolute top-1/2 -translate-y-1/2 border-y-[0.3125rem] border-y-transparent ${side}`}
      style={facingRight ? { borderLeftColor: colour } : { borderRightColor: colour }}
    />
  )
}

/** The weapon, damage and stocks left of a player, shown above them during playback. */
export function PoseTag({ pose }: { pose: Pose }) {
  const icon = weaponIconName(pose.weapon) ?? 'Unarmed'
  const stockNumbers = Array.from({ length: pose.stocksLeft }, (_, index) => index + 1)

  return (
    <div className="mb-0.5 flex items-center gap-1 rounded-sm bg-ink/80 px-1 text-xs leading-4 font-black tabular-nums">
      <img src={`/images/weapons/${icon}.svg`} alt="" className="size-3.5 object-contain" />
      <span style={{ color: damageColour(pose.damage) }}>{formatDamage(pose.damage)}</span>
      <span className="flex gap-0.5">
        {stockNumbers.map((stockNumber) => (
          <span key={stockNumber} className="size-1 rounded-full bg-strong" />
        ))}
      </span>
    </div>
  )
}

function portraitLook(pose: Pose): string {
  const dodging = pose.isDodging ? 'opacity-50' : ''
  const stunned = pose.isHitstun ? 'brightness-150 saturate-50' : ''

  return `${dodging} ${stunned}`
}

function Token({ pose, player, isPicked }: { pose: Pose; player: StagePlayer; isPicked: boolean }) {
  const colour = slotColour(pose.slot)

  return (
    <div
      className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-full flex-col items-center"
      style={{ left: `${pose.x * 100}%`, top: `${pose.y * 100}%`, zIndex: isPicked ? 2 : 1 }}
    >
      <PoseTag pose={pose} />
      <div className="relative">
        <img
          src={legendAvatarUrl(player.legendKey)}
          alt={player.name}
          className={`block size-9 rounded-md bg-raised object-cover object-top ${portraitLook(pose)}`}
          style={{ boxShadow: `0 0 0 2px ${colour}` }}
        />
        <FacingWedge facingRight={pose.facingRight} colour={colour} />
      </div>
    </div>
  )
}

/** Whether a player stands in the frame: in play, and within it give or take the size of a token. */
export function isOnScreen(pose: Pose): boolean {
  return pose.isInPlay && pose.x > -0.02 && pose.x < 1.02 && pose.y > -0.02 && pose.y < 1.08
}

/** Draws each player as a token: their legend's portrait in their colour, with weapon, damage and stocks above it. */
export function TokenPoses({ poses, players, selectedSlot }: TokenPosesProps) {
  return poses.filter(isOnScreen).map((pose) => {
    const player = players.find((entry) => entry.slot === pose.slot)

    if (!player) return null

    return <Token key={pose.slot} pose={pose} player={player} isPicked={pose.slot === selectedSlot} />
  })
}
