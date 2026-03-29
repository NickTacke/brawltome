import { OverlayPanel } from './components/OverlayPanel'
import { useGameEvents } from './hooks/useGameEvents'

export default function App() {
  const { opponents, matchType } = useGameEvents()

  return (
    <div className="flex h-screen items-center justify-end p-4">
      <OverlayPanel opponents={opponents} matchType={matchType} />
    </div>
  )
}
