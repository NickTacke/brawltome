import type { StageHit, StageKo } from '@brawltome/contracts'
import { formatDamage } from '../match-format'
import { slotColour } from '../match-styles'
import { bodyRingStyle, type DrawnBodies } from './body-ring'
import { KoArrow } from './KoArrow'

// how long a hit flashes and a KO marker stays on the edge
const hitFlashMs = 450
const koMarkerMs = 1800
// the flash's ring starts at this share of the ring around the body and spreads out to the whole of it
const flashStartShare = 0.25
const flashMark = 'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2'

// which way a player left the picture, as a turn of a triangle that points up
function turnOf(ko: StageKo): number {
  if (ko.y <= 0) return 0

  if (ko.x >= 1) return 90

  return ko.y >= 1 ? 180 : 270
}

// a hit's spot is where the target's feet are. the flash's ring is on their body and spreads to the ring around it;
// the damage rises from the spot itself
function HitFlash({ hit, bodies, timeMs }: { hit: StageHit; bodies: DrawnBodies; timeMs: number }) {
  const age = (timeMs - hit.timeMs) / hitFlashMs
  const ring = bodyRingStyle(hit, bodies, flashStartShare + (1 - flashStartShare) * age)
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

// on the edge of the picture where the player went out, kept a little inside it so the whole marker shows
function KoMarker({ ko }: { ko: StageKo }) {
  const left = Math.min(Math.max(ko.x * 100, 1.5), 98.5)
  const top = Math.min(Math.max(ko.y * 100, 2.5), 97.5)

  return (
    <span
      className="pointer-events-none absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <KoArrow colour={slotColour(ko.victim)} turnDeg={turnOf(ko)} className="size-4" />
    </span>
  )
}

type PlayEffectsProps = {
  hits: StageHit[]
  kos: StageKo[]
  // how the players are drawn, which is how big the flash on one is
  bodies: DrawnBodies
  timeMs: number
}

/** What just happened at the playback clock: a flash with the damage where a hit landed, and a marker where a player went out. */
export function PlayEffects({ hits, kos, bodies, timeMs }: PlayEffectsProps) {
  const recentHits = hits.filter((hit) => timeMs >= hit.timeMs && timeMs - hit.timeMs < hitFlashMs)
  const recentKos = kos.filter((ko) => timeMs >= ko.timeMs && timeMs - ko.timeMs < koMarkerMs)

  return (
    <>
      {recentHits.map((hit) => (
        <HitFlash key={`${hit.attacker}-${hit.target}-${hit.timeMs}`} hit={hit} bodies={bodies} timeMs={timeMs} />
      ))}
      {recentKos.map((ko) => (
        <KoMarker key={`${ko.victim}-${ko.timeMs}`} ko={ko} />
      ))}
    </>
  )
}
