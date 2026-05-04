import { OverlayPanel } from './components/OverlayPanel'
import { StatusBadge } from './components/StatusBadge'
import { useGameEvents } from './hooks/useGameEvents'

export default function App() {
  const { opponents, matchType, visible, scanning, refreshing, detectionStatus, localPlayerBhid } =
    useGameEvents()

  return (
    <div className="flex h-screen items-center justify-end p-4">
      <div className="flex flex-col items-end gap-1.5">
        <OverlayPanel
          opponents={opponents}
          matchType={matchType}
          visible={visible}
          scanning={scanning}
          refreshing={refreshing}
        />
        <StatusBadge status={detectionStatus} bhid={localPlayerBhid} />
      </div>
    </div>
  )
}
