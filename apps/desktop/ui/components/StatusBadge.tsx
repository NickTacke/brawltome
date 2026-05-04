import type { DetectionStatus } from '../types'

interface StatusBadgeProps {
  status: DetectionStatus
  bhid: number | null
}

const STATUS_COLORS: Record<Exclude<DetectionStatus, 'idle'>, string> = {
  attaching: 'hsl(40, 90%, 60%)',
  player_loaded: 'hsl(212, 90%, 60%)',
  ready: 'hsl(142, 70%, 45%)',
}

function labelFor(status: DetectionStatus, bhid: number | null): string {
  if (status === 'attaching') return 'Connecting...'
  if (status === 'player_loaded') return bhid ? `Loaded (${bhid})` : 'Loading state...'
  if (status === 'ready') return 'Ready'
  return ''
}

export function StatusBadge({ status, bhid }: StatusBadgeProps) {
  if (status === 'idle') return null

  const dotColor = STATUS_COLORS[status]
  const label = labelFor(status, bhid)

  return (
    <div
      className="pointer-events-none flex items-center"
      style={{
        padding: '6px 16px 6px 10px',
        borderRadius: 9999,
        border: '1px solid hsla(221.5, 20.3%, 25.1%, 0.7)',
        background: 'hsla(224, 19.5%, 15.1%, 0.95)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
        gap: 10,
        animation: 'attach-toast-fade-in 220ms ease-out forwards',
      }}
    >
      <img
        src="/icon.png"
        alt=""
        style={{
          width: 28,
          height: 28,
          objectFit: 'contain',
          background: 'transparent',
          flexShrink: 0,
        }}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
      <div
        style={{
          width: 1,
          height: 20,
          background: 'hsla(221.5, 20.3%, 25.1%, 0.9)',
          flexShrink: 0,
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 12,
          fontWeight: 600,
          color: 'hsl(207.3, 21.6%, 90%)',
          lineHeight: 1,
        }}
      >
        <div
          className={status === 'ready' ? '' : 'animate-pulse'}
          style={{
            width: 8,
            height: 8,
            borderRadius: '9999px',
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <span>{label}</span>
      </div>
    </div>
  )
}
