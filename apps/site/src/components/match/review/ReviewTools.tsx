import type { ReviewScope } from '@brawltome/contracts'
import { FilterSelect } from '../../FilterSelect'
import { CameraSelect } from '../stage/CameraSelect'
import type { CameraMode } from '../stage/camera-mode'
import type { ReviewChoice } from './review-stops'

const toolButton =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors phone:min-h-11 phone:px-3.5'

function toolButtonState(isOn: boolean): string {
  return isOn ? 'bg-raised text-strong' : 'text-soft hover:text-strong'
}

type ReviewToolsProps = {
  isReview: boolean
  onReview: (isReview: boolean) => void
  choices: ReviewChoice[]
  scope: ReviewScope
  onScope: (scope: ReviewScope) => void
  // null when the line has no animations, which always shows the whole stage
  cameraMode: CameraMode | null
  onCameraMode: (mode: CameraMode) => void
}

function ModeButton({ label, isOn, onPress }: { label: string; isOn: boolean; onPress: () => void }) {
  return (
    <button type="button" aria-pressed={isOn} onClick={onPress} className={`${toolButton} ${toolButtonState(isOn)}`}>
      {label}
    </button>
  )
}

/**
 * Next to the replay's heading: what a review steps through, how the camera moves, and watching or reviewing. On a
 * phone, watching or reviewing stays next to the heading and the two menus take a row of their own under it, so the
 * switch doesn't move when a review adds its menu.
 */
export function ReviewTools(props: ReviewToolsProps) {
  const { isReview, onReview, choices } = props

  const scopeOptions = choices.map((choice) => ({
    value: choice.key,
    label: `${choice.label} · ${choice.stops.length}`,
  }))

  const pickScope = (value: string) => {
    const choice = choices.find((entry) => entry.key === value)

    if (choice) props.onScope(choice.key)
  }

  const hasMenus = isReview || props.cameraMode !== null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 phone:contents">
      {/* on a phone the menus drop to a row of their own after the switch, so a review's menu never moves it */}
      {hasMenus ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 phone:order-1 phone:w-full">
          {isReview ? (
            <FilterSelect label="Review" value={props.scope} options={scopeOptions} onChange={pickScope} />
          ) : null}
          {props.cameraMode ? <CameraSelect mode={props.cameraMode} onMode={props.onCameraMode} /> : null}
        </div>
      ) : null}
      <div className="inline-flex gap-0.5 rounded-lg bg-raised/50 p-0.5">
        <ModeButton label="Watch" isOn={!isReview} onPress={() => onReview(false)} />
        <ModeButton label="Review" isOn={isReview} onPress={() => onReview(true)} />
      </div>
    </div>
  )
}
