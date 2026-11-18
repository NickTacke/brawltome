import { FilterSelect } from '../../FilterSelect'
import { type CameraMode, cameraModeOptions, isCameraMode } from './camera-mode'

/** How the replay's camera moves: the game's own, or fixed on the whole stage. */
export function CameraSelect({ mode, onMode }: { mode: CameraMode; onMode: (mode: CameraMode) => void }) {
  return (
    <FilterSelect
      label="Camera"
      value={mode}
      options={cameraModeOptions}
      onChange={(value) => isCameraMode(value) && onMode(value)}
    />
  )
}
