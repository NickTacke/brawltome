import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MainWindow } from './MainWindow'
import { useAppStatus } from './useAppStatus'

const root = document.getElementById('root') as HTMLElement

function MainWindowPage() {
  const app = useAppStatus()

  // both come in within a moment of the page loading; the window stays blank until then
  if (app.status === null || app.settings === null) return null

  return (
    <MainWindow
      status={app.status}
      settings={app.settings}
      nowMs={app.nowMs}
      onOpenProfile={app.openProfile}
      onResume={app.resumeOverlay}
      onOverlayPositionChange={app.changeOverlayPosition}
      onStartsWithWindowsChange={app.changeStartsWithWindows}
      onMinimize={app.minimize}
      onClose={app.close}
    />
  )
}

createRoot(root).render(
  <StrictMode>
    <MainWindowPage />
  </StrictMode>,
)
