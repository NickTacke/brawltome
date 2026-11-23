import { useState } from 'react'
import type { AppStatus, Settings } from '../window/app-status'
import { MainWindow } from '../window/MainWindow'
import { appStatusFixture, fixtureNowMs, windowVariantCells } from './window-fixtures'

// ?page=window&status=<fixture> draws one fixture where the app opens the window, bottom right of a 1080p desktop;
// &status=variants draws the states side by side
export function WindowPreview({ status }: { status: string }) {
  if (status === 'variants') return <VariantsSheet />

  const fixture = appStatusFixture(status)

  if (fixture === null) return <p className="preview-missing">No fixture named app-status-{status}.json</p>

  return (
    <div className="preview-desktop">
      <PreviewWindow status={fixture} nowMs={fixtureNowMs(fixture)} />
      <div className="preview-taskbar">
        <img className="preview-tray-icon" src="/icon.png" alt="" />
        <span className="preview-clock">21:42</span>
      </div>
    </div>
  )
}

function VariantsSheet() {
  return (
    <div className="preview-window-sheet">
      {windowVariantCells().map((cell) => (
        <div className="preview-cell" key={cell.title}>
          <h2>{cell.title}</h2>
          <PreviewWindow status={cell.status} nowMs={cell.nowMs} />
        </div>
      ))}
    </div>
  )
}

// the picker and the toggle work in the preview; nothing is saved
function PreviewWindow({ status, nowMs }: { status: AppStatus; nowMs: number }) {
  const [settings, setSettings] = useState<Settings>({ overlayPosition: 'middleRight', startsWithWindows: true })

  return (
    <MainWindow
      status={status}
      settings={settings}
      nowMs={nowMs}
      onOpenProfile={(brawlhallaId) => console.info(`open profile ${brawlhallaId}`)}
      onResume={() => console.info('resume the overlay')}
      onOverlayPositionChange={(overlayPosition) => setSettings({ ...settings, overlayPosition })}
      onStartsWithWindowsChange={(startsWithWindows) => setSettings({ ...settings, startsWithWindows })}
      onMinimize={() => console.info('minimise')}
      onClose={() => console.info('close')}
    />
  )
}
