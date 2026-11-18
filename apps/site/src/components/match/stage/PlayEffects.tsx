import type { StageHit, StageKo } from '@brawltome/contracts'
import { formatDamage } from '../match-format'
import { slotColour } from '../match-styles'
import { KoArrow } from './KoArrow'

// how long a hit flashes and a KO marker stays on the edge
const hitFlashMs = 450
const koMarkerMs = 1800

// which way a player left the picture, as a turn of a triangle that points up
function turnOf(ko: StageKo): number {
  if (ko.y <= 0) return 0

  if (ko.x >= 1) return 90

  return ko.y >= 1 ? 180 : 270
}

function HitFlash({ hit, timeMs }: { hit: StageHit; timeMs: number }) {
  const age = (timeMs - hit.timeMs) / hitFlashMs

  return (
    <span
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-sm font-black text-strong tabular-nums"
      style={{ left: `${hit.x * 100}%`, top: `${hit.y * 100}%`, opacity: 1 - age }}
    >
      <span
        className="absolute top-1/2 left-1/2 size-6 rounded-full border-2"
        style={{ borderColor: slotColour(hit.attacker), transform: `translate(-50%, -50%) scale(${0.6 + age * 1.6})` }}
      />
      <span className="relative" style={{ top: `${-1 - age}rem` }}>
        {formatDamage(hit.damage)}
      </span>
    </span>
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

type PlayEffectsProps = { hits: StageHit[]; kos: StageKo[]; timeMs: number }

/** What just happened at the playback clock: a flash with the damage where a hit landed, and a marker where a player went out. */
export function PlayEffects({ hits, kos, timeMs }: PlayEffectsProps) {
  const recentHits = hits.filter((hit) => timeMs >= hit.timeMs && timeMs - hit.timeMs < hitFlashMs)
  const recentKos = kos.filter((ko) => timeMs >= ko.timeMs && timeMs - ko.timeMs < koMarkerMs)

  return (
    <>
      {recentHits.map((hit) => (
        <HitFlash key={`${hit.attacker}-${hit.target}-${hit.timeMs}`} hit={hit} timeMs={timeMs} />
      ))}
      {recentKos.map((ko) => (
        <KoMarker key={`${ko.victim}-${ko.timeMs}`} ko={ko} />
      ))}
    </>
  )
}
