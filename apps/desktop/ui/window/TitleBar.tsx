type TitleBarProps = { onMinimize: () => void; onClose: () => void }

// the window has no system frame, so the bar drags it; the banner below hangs up behind it
export function TitleBar({ onMinimize, onClose }: TitleBarProps) {
  return (
    <header className="title-bar" data-tauri-drag-region>
      <img className="title-icon" src="/icon.png" alt="" />
      <span className="title">BrawlTome</span>
      <button type="button" className="window-control" aria-label="Minimise" onClick={onMinimize}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button type="button" className="window-control close" aria-label="Close" onClick={onClose}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </header>
  )
}
