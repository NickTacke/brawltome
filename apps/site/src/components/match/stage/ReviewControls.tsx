import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { formatClock } from '../match-format'
import { type Playback, playbackSpeeds } from './use-playback'

const barButton =
  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-soft transition-colors hover:bg-raised hover:text-strong disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent'

// what the two buttons beside play do: a step in time while watching, a step to a stop in a review
export type Stepping = {
  backLabel: string
  onLabel: string
  canStepBack: boolean
  canStepOn: boolean
  onStep: (direction: -1 | 1) => void
}

// which stop of how many a review is on, none of them yet before the first one, and what plays it once more
export type StopCount = { index: number; total: number; onReplay: () => void }

type StepButtonProps = { label: string; keyName: string; isEnabled: boolean; onPress: () => void; isOn: boolean }

function StepButton({ label, keyName, isEnabled, onPress, isOn }: StepButtonProps) {
  const Icon = isOn ? ChevronRight : ChevronLeft

  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${keyName})`}
      disabled={!isEnabled}
      onClick={onPress}
      className={barButton}
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  )
}

type TransportButtonsProps = { playback: Playback; stepping: Stepping }

// play between a step back and a step on, as the space bar sits between the arrow keys that do the same
function TransportButtons({ playback, stepping }: TransportButtonsProps) {
  const playLabel = playback.isPlaying ? 'Pause' : 'Play'
  const PlayIcon = playback.isPlaying ? Pause : Play

  return (
    <div className="flex items-center gap-0.5">
      <StepButton
        label={stepping.backLabel}
        keyName="←"
        isEnabled={stepping.canStepBack}
        onPress={() => stepping.onStep(-1)}
        isOn={false}
      />
      <button
        type="button"
        aria-label={playLabel}
        title={`${playLabel} (Space)`}
        onClick={playback.toggle}
        className={`${barButton} size-8 bg-raised text-strong hover:bg-line`}
      >
        <PlayIcon className="size-4" aria-hidden="true" />
      </button>
      <StepButton
        label={stepping.onLabel}
        keyName="→"
        isEnabled={stepping.canStepOn}
        onPress={() => stepping.onStep(1)}
        isOn
      />
    </div>
  )
}

type ReplayClockProps = {
  playback: Playback
  // false where something else needs the room: the time alone
  hasLength: boolean
}

// on a phone's stage, the length of the match makes way for the buttons
function ReplayClock({ playback, hasLength }: ReplayClockProps) {
  return (
    <span className="shrink-0 font-mono text-xs text-soft tabular-nums">
      <span className="text-strong">{formatClock(playback.timeMs)}</span>
      {hasLength ? <span className="@max-[30rem]:hidden"> / {formatClock(playback.durationMs)}</span> : null}
    </span>
  )
}

/** After the lanes on the stage: the speed. A menu would be cut off by the stage's edge, so it is a button that steps through the speeds. */
export function SpeedButton({ playback }: { playback: Playback }) {
  const { speed, setSpeed } = playback
  const next = playbackSpeeds[(playbackSpeeds.indexOf(speed) + 1) % playbackSpeeds.length] ?? 1

  return (
    <button
      type="button"
      aria-label={`Speed ${speed}×, switch to ${next}×`}
      onClick={() => setSpeed(next)}
      className={`${barButton} w-auto min-w-7 px-1 font-mono text-xs font-semibold text-strong`}
    >
      {speed}×
    </button>
  )
}

// pressing the count plays the stop it names once more
function StopCountButton({ count }: { count: StopCount }) {
  return (
    <button
      type="button"
      aria-label="Replay this stop"
      title="Replay this stop (R)"
      disabled={count.index < 0}
      onClick={count.onReplay}
      className="cursor-pointer rounded-md bg-white/[0.07] px-1.5 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap text-strong tabular-nums transition-colors hover:bg-white/[0.14] disabled:cursor-default disabled:hover:bg-white/[0.07]"
    >
      {count.index + 1}
      <span className="font-normal text-soft">&nbsp;of {count.total}</span>
    </button>
  )
}

type TransportColumnProps = TransportButtonsProps & {
  // a review's place among its stops; none while watching
  count: StopCount | null
}

/**
 * In the stage's corner: the steps around play, and under them the clock. In a review the clock gives the length of
 * the match up for which stop it is on, so the corner is as wide in both and the lanes never move.
 */
export function TransportColumn({ playback, stepping, count }: TransportColumnProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <TransportButtons playback={playback} stepping={stepping} />
      <div className="flex h-5 items-center gap-1.5">
        <ReplayClock playback={playback} hasLength={count === null} />
        {count ? <StopCountButton count={count} /> : null}
      </div>
    </div>
  )
}
