// how the replay's camera moves: the game's own camera, or fixed on the whole stage

export type CameraMode = 'game' | 'stage'

export const cameraModeOptions: { value: CameraMode; label: string }[] = [
  { value: 'game', label: 'Game' },
  { value: 'stage', label: 'Fixed' },
]

// the game's own camera, checked frame by frame against the view the game draws
export const defaultCameraMode: CameraMode = 'game'

export function isCameraMode(value: string): value is CameraMode {
  return cameraModeOptions.some((option) => option.value === value)
}
