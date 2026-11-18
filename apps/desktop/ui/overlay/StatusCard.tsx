import { Spinner } from './CardHead'
import type { StatusView } from './overlay-view'

// shown when the game starts, so the player knows the app found it and whether it can read this patch
export function StatusCard({ status }: { status: StatusView }) {
  return (
    <div className="card status-card">
      <span className="main">
        <span className="head">
          <img className="app-icon" src="/icon.png" alt="" />
          <span className="who">
            <span className="name">BrawlTome</span>
            <StatusLine status={status} />
          </span>
          {status.state === 'connecting' && <Spinner />}
        </span>
      </span>
    </div>
  )
}

function StatusLine({ status }: { status: StatusView }) {
  if (status.state === 'connecting') return <span className="sub">Connecting to Brawlhalla</span>

  if (status.state === 'unsupported') {
    const version = status.patch === null ? 'This game version' : `Patch ${status.patch}`

    return <span className="sub status-warn">{version} isn't supported yet</span>
  }

  return (
    <span className="sub">
      <span className="status-ready">Ready</span>
      <span className="dot">·</span>Patch {status.patch}
    </span>
  )
}
