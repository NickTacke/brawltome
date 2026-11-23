import type { OverlayPosition, Settings } from './app-status'
import { PositionPicker } from './PositionPicker'

type SettingsSectionProps = {
  settings: Settings
  onOverlayPositionChange: (position: OverlayPosition) => void
  onStartsWithWindowsChange?: (isOn: boolean) => void
}

export function SettingsSection({
  settings,
  onOverlayPositionChange,
  onStartsWithWindowsChange,
}: SettingsSectionProps) {
  return (
    <section className="settings">
      {onStartsWithWindowsChange !== undefined && (
        <div className="setting-row">
          <span className="setting">Start with Windows</span>
          <button
            type="button"
            role="switch"
            className="toggle"
            aria-label="Start with Windows"
            aria-checked={settings.startsWithWindows}
            onClick={() => onStartsWithWindowsChange(!settings.startsWithWindows)}
          >
            <span className="toggle-knob" />
          </button>
        </div>
      )}
      <div className="setting-row">
        <span className="setting">
          Overlay spot
          <small>Where the cards show up in game</small>
        </span>
        <PositionPicker position={settings.overlayPosition} onChange={onOverlayPositionChange} />
      </div>
    </section>
  )
}
