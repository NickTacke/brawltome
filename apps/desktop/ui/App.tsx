import { OverlayPanel } from './components/OverlayPanel'
import { useGameEvents } from './hooks/useGameEvents'

export default function App() {
  const { opponents, matchType } = useGameEvents()

  return (
    <div className="flex h-screen items-start justify-end p-4 pt-20">
      <OverlayPanel opponents={opponents} matchType={matchType} />
    </div>
  )
}
