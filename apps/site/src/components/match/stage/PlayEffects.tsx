import type { StageHit } from '@brawltome/contracts'
import { formatDamage } from '../match-format'
import { slotColour } from '../match-styles'
import { bodyRingStyle, type DrawnBodies } from './body-ring'

// how long a hit flashes
const hitFlashMs = 450
// the flash's ring starts at this share of the ring around the body and spreads out to the whole of it
const flashStartShare = 0.25
const flashMark = 'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2'

// a hit's spot is where the target's feet are. the flash's ring is on their body and spreads to the ring around it;
// the damage rises from the spot itself
function HitFlash({ hit, bodies, timeMs }: { hit: StageHit; bodies: DrawnBodies; timeMs: number }) {
  const age = (timeMs - hit.timeMs) / hitFlashMs
  const ring = bodyRingStyle(hit, bodies, hit.target, flashStartShare + (1 - flashStartShare) * age)
  const opacity = 1 - age

  return (
    <>
      <span
        className={`${flashMark} rounded-full border-2`}
        style={{ ...ring, borderColor: slotColour(hit.attacker), opacity }}
      />
      <span
        className={`${flashMark} text-sm font-black text-strong tabular-nums`}
        style={{ left: `${hit.x * 100}%`, top: `${hit.y * 100}%`, marginTop: `${-1 - age}rem`, opacity }}
      >
        {formatDamage(hit.damage)}
      </span>
    </>
  )
}

type PlayEffectsProps = {
  hits: StageHit[]
  // how the players are drawn, which is how big the flash on one is
  bodies: DrawnBodies
  timeMs: number
}

/** What just happened on the stage at the playback clock: a flash with the damage where a hit landed. */
export function PlayEffects({ hits, bodies, timeMs }: PlayEffectsProps) {
  const recentHits = hits.filter((hit) => timeMs >= hit.timeMs && timeMs - hit.timeMs < hitFlashMs)

  return (
    <>
      {recentHits.map((hit) => (
        <HitFlash key={`${hit.attacker}-${hit.target}-${hit.timeMs}`} hit={hit} bodies={bodies} timeMs={timeMs} />
      ))}
    </>
  )
}
