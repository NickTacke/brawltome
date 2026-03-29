import { OverlayPanel } from './components/OverlayPanel'
import { useGameEvents } from './hooks/useGameEvents'

export default function App() {
  const { opponents, visible } = useGameEvents()

  return (
    <div className="flex h-screen items-start justify-end p-4 pt-20">
      <OverlayPanel opponents={opponents} visible={visible} />
    </div>
  )
}
