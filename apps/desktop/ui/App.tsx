import { useCursorForwarding } from './hooks/useCursorForwarding'

export default function App() {
  const { onMouseEnter, onMouseLeave } = useCursorForwarding()

  return (
    <div className="flex h-screen items-center justify-end p-4">
      <div
        className="rounded-lg bg-zinc-900/90 p-4 text-white shadow-lg backdrop-blur"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <p className="text-sm">BrawlTome Overlay</p>
      </div>
    </div>
  )
}
