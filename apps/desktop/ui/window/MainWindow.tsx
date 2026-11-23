import '../shared/tokens.css'
import './window.css'
import type { AppStatus, OverlayPosition, Settings } from './app-status'
import { RecentMatches } from './RecentMatches'
import { SettingsSection } from './SettingsSection'
import { StandingHeader } from './StandingHeader'
import { StatusSection } from './StatusSection'
import { statusLines } from './status-format'
import { TitleBar } from './TitleBar'

export type MainWindowProps = {
  status: AppStatus
  settings: Settings
  nowMs: number
  onOpenProfile: (brawlhallaId: number) => void
  onResume: () => void
  onOverlayPositionChange: (position: OverlayPosition) => void
  onStartsWithWindowsChange: (isOn: boolean) => void
  onMinimize: () => void
  onClose: () => void
}

export function MainWindow({
  status,
  settings,
  nowMs,
  onOpenProfile,
  onResume,
  onOverlayPositionChange,
  onStartsWithWindowsChange,
  onMinimize,
  onClose,
}: MainWindowProps) {
  return (
    <div className="window">
      <TitleBar onMinimize={onMinimize} onClose={onClose} />
      <StandingHeader you={status.you} nowMs={nowMs} />
      <StatusSection lines={statusLines(status)} onResume={onResume} />
      <RecentMatches matches={status.recentMatches} nowMs={nowMs} onOpenProfile={onOpenProfile} />
      <SettingsSection
        settings={settings}
        onOverlayPositionChange={onOverlayPositionChange}
        onStartsWithWindowsChange={onStartsWithWindowsChange}
      />
    </div>
  )
}
